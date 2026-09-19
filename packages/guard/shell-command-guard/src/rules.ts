/**
 * Pure shell-command risk classification for the shell-command guard: the
 * deny/ask/allow verdicts and the allow-path exemption. It imports nothing
 * from Harness or Cordis so the rules stay independently testable and cannot
 * fail to load with the plugin.
 *
 * The deny set is a security invariant and stays fixed in code. The only
 * deployment-varying input is {@link AnalyzeOptions.allowPaths}, whose
 * recursive-force-delete exemption is deliberately narrow: an explicit
 * allow path never overrides a deny verdict.
 *
 * @module @deepseek-ai/dsh-shell-command-guard/rules
 */

/** One command's classification. */
export interface CommandVerdict {
  /** Selected action for the command. */
  action: 'allow' | 'ask' | 'deny'
  /** Model-facing explanation of the verdict; empty for `allow`. */
  reason: string
}

/** Deployment inputs that bound the classification. */
export interface AnalyzeOptions {
  /**
   * Path prefixes whose recursive-force deletion is exempt from the `ask`
   * verdict (see {@link matchesAllowPath}). A deny verdict is never exempted.
   */
  allowPaths?: readonly string[]
  /**
   * Absolute OS home directory used to expand `$home`, `$env:USERPROFILE`,
   * and `~` before path matching. Empty means no expansion.
   */
  home?: string
}

/** Destructive delete verbs shared by PowerShell, cmd, and POSIX shells. */
const DELETE_VERB = /\b(?:Remove-Item|Remove-Item2|Remove|rm|ri|del|erase|rd|rmdir)\b/i

/** A recursive flag: `-Recurse`, `--recursive`, `rd /s`, or a bundled `-r`. */
const RECURSE_FLAG = /-recurse\b|--recursive|\/s\b|-r(?=[\s"';&|)\]]|$)/i

/** A force flag: `-Force`, `--force`, `rd /q`, or a bundled `-f`. */
const FORCE_FLAG = /-force\b|--force|\/q\b|-f(?=[\s"';&|)\]]|$)/i

/** Bundled POSIX recursive+force delete, e.g. `rm -rf`, `rm -fr`, `rm -rvf`. */
const POSIX_RECURSIVE_FORCE = /\brm\b[^\n;|&]*-[a-z]*r[a-z]*f[a-z]*/i

/** A direct `$home` / `$env:USERPROFILE` reference without a bounded subpath. */
const HOME_DIRECT = /(?:\$home|\$env:userprofile)\b(?!\\[^*])/i

/** A direct `~` reference, excluding `~/subpath` and `~\subpath`. */
const TILDE_DIRECT = /(?<![\\/\w])~(?:$|[\s"';&|)\]](?:\*)?|\\\*|\\$)/

/** Drive root, e.g. `C:\`, `C:\*`, `D:/`. */
const DRIVE_ROOT = /[a-zA-Z]:[\\/]\*?(?=$|[\s"';&|)\]])/

/** The DSH home directory (`.dsh` / the branded `.qomicex` home). */
const HARNESS_HOME_DIRECT = /(?:^|[\\/])\.(?:dsh|qomicex)(?=$|[\s"';&|)\]](?:\*)?|\\\*)/

/** POSIX root/home delete: `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`. */
const POSIX_RM_ROOT = /\brm\b[^\n;|&]*(?:\s\/|\s~(?=$|[\s;|&])|\s\$HOME\b)(?:\s|$)/i

/** Disk formatting and partitioning tools. */
const FORMAT_DISK = /\b(?:Format-Volume|Clear-Disk|diskpart)\b|\bformat\s+(?:[a-z]:|[a-z](?=[\s"';&|)\]])|$)/i

/** POSIX filesystem creation on a device or partition. */
const POSIX_MKFS = /\bmkfs(?:\.\w+)?\b|\bmkswap\b|\bfdisk\b|\bparted\b|\bsgdisk\b|\bcfdisk\b/i

/** Raw device write, e.g. `dd if=... of=/dev/sda`. */
const POSIX_DEVICE_WRITE = /\bdd\b[^\n;|&]*of=\s*\/dev\/[a-z]/i

/** Recursive ownership change of the filesystem root, e.g. `chmod -R 777 /`. */
const POSIX_ROOT_CHMOD = /\bchmod\b[^\n;|&]*-[a-z]*R[a-z]*\s+[0-7]+\s+\/(?:\s|$)/i

/** Kill every process the user may signal. */
const POSIX_KILL_ALL = /\bkill\b[^\n;|&]*-9\s+-1\b/i

/** Shell fork bomb `:(){ :|:& };:`. */
const SHELL_FORK_BOMB = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/

/** Host power transitions that end every session on the machine. */
const POSIX_POWER = /\b(?:shutdown|reboot|halt|poweroff)\b/i

/** Force push that overwrites remote history (`--force-with-lease` is exempt). */
const GIT_FORCE_PUSH = /\bgit\s+push\b[^\n]*(?:--force(?!-with-lease)|(?:\s|^)-f(?:\s|$))/i

/** Destructive SQL statements. */
const SQL_DESTRUCTIVE = /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i

/**
 * Default recursive-force-delete exemptions: regenerable toolchain and cache
 * directories whose deletion cannot reach user data. Deployments append their
 * own roots through the plugin's `allowPaths` config.
 */
export const DEFAULT_ALLOW_PATHS: readonly string[] = [
  '$env:USERPROFILE\\.rustup\\toolchains\\',
  '$env:USERPROFILE\\.rustup\\downloads\\',
  '$env:USERPROFILE\\.cargo\\registry\\',
  '$env:USERPROFILE\\AppData\\Local\\Temp\\',
  '$env:USERPROFILE\\AppData\\Local\\npm-cache\\',
  '$env:USERPROFILE\\AppData\\Local\\pip\\cache\\',
  '$env:USERPROFILE\\AppData\\Local\\NuGet\\v3-cache\\',
]

/**
 * Expand home references in arbitrary command text.
 * @param text - command text that may contain `$env:USERPROFILE`, `$home`, or `~`.
 * @param home - absolute home directory; empty leaves the references unexpanded.
 * @returns the text with every home reference replaced by {@link home}.
 */
export function expandPathRefs(text: string, home: string): string {
  if (text === '') return ''
  const replacement = home === '' ? '' : home
  return text
    .replace(/\$env:USERPROFILE/gi, replacement)
    .replace(/\$home\b/gi, replacement)
    .replace(/(^|[^\\/\w])~(?=[\\/]|$)/g, (_match, prefix: string) => prefix + replacement)
}

/**
 * Test whether a command names a path under one of the allowed prefixes.
 * Matching is case-insensitive and separator-insensitive (`\` and `/` are the
 * same), and the prefix may appear anywhere in the command.
 * @param command - full command text.
 * @param allowPaths - path prefixes to test.
 * @param home - absolute home directory used to expand both sides.
 * @returns whether at least one non-empty prefix appears in the command.
 */
export function matchesAllowPath(command: string, allowPaths: readonly string[], home: string): boolean {
  if (allowPaths.length === 0) return false
  const expanded = expandPathRefs(command, home).toLowerCase().replace(/\\/g, '/')
  return allowPaths.some((path) => {
    if (path.trim() === '') return false
    const prefix = expandPathRefs(path, home).toLowerCase().replace(/\\/g, '/')
    return prefix !== '' && expanded.includes(prefix)
  })
}

/**
 * Test whether command text targets `C:\Users` or a user folder directly
 * (rather than a bounded subpath, which only needs approval).
 * @param text - command text.
 * @returns whether the text recursively targets the users root or one user.
 */
function targetsUsersRoot(text: string): boolean {
  const re = /[a-z]:[\\/]users([\\/][^\\/\s"';&|)\]]*)?/gi
  let match = re.exec(text)
  while (match !== null) {
    const after = text.slice(match.index + match[0].length)
    if (/^\\\*|^\\$|^[\s"';&|)\]]|^$/.test(after)) return true
    match = re.exec(text)
  }
  return false
}

/**
 * Classify one shell command.
 *
 * Precedence: an explicit allow-path exemption only reaches recursive-force
 * deletion, so a command that both deletes a user directory and deletes a
 * cache directory stays denied. `deny` results never depend on
 * {@link AnalyzeOptions.allowPaths}.
 * @param command - full command text extracted from the tool arguments.
 * @param options - deployment inputs; omitted means no allow paths and no home.
 * @returns the verdict and its model-facing reason (empty for `allow`).
 */
export function analyzeCommand(command: string, options: AnalyzeOptions = {}): CommandVerdict {
  if (command.trim() === '') return { action: 'allow', reason: '' }
  const allowPaths = options.allowPaths ?? []
  const home = options.home ?? ''
  const text = command

  if (FORMAT_DISK.test(text) || POSIX_MKFS.test(text) || POSIX_DEVICE_WRITE.test(text)) {
    return {
      action: 'deny',
      reason: 'Disk formatting, partitioning, or raw device writes are blocked: format / Format-Volume / Clear-Disk / diskpart / mkfs / fdisk / dd to a device can destroy an entire volume.',
    }
  }

  if (SHELL_FORK_BOMB.test(text)) {
    return { action: 'deny', reason: 'The shell fork bomb pattern is blocked: it exhausts every process slot on the host.' }
  }

  if (POSIX_KILL_ALL.test(text)) {
    return { action: 'deny', reason: 'Signalling every process (`kill -9 -1`) is blocked: it terminates unrelated sessions and services.' }
  }

  if (POSIX_ROOT_CHMOD.test(text)) {
    return { action: 'deny', reason: 'Recursively changing permissions of the filesystem root is blocked: it can make the host unrecoverable.' }
  }

  const hasDelete = DELETE_VERB.test(text)

  if (hasDelete
    && (HOME_DIRECT.test(text) || TILDE_DIRECT.test(text) || targetsUsersRoot(text)
      || DRIVE_ROOT.test(text) || HARNESS_HOME_DIRECT.test(text) || POSIX_RM_ROOT.test(text))) {
    return {
      action: 'deny',
      reason: 'Deleting the user home directory, a user folder, a drive root, or the harness home directory is blocked. Note: in PowerShell `$HOME`/`$home` auto-resolves to the user profile directory, so deleting it removes all user data. Name the exact target path instead.',
    }
  }

  const recursiveForce = (RECURSE_FLAG.test(text) && FORCE_FLAG.test(text)) || POSIX_RECURSIVE_FORCE.test(text)

  if (hasDelete && recursiveForce && matchesAllowPath(text, allowPaths, home)) {
    return { action: 'allow', reason: '' }
  }

  if (hasDelete && recursiveForce) {
    return {
      action: 'ask',
      reason: 'Recursive force deletion (-Recurse -Force / rm -rf / rd /s /q) needs human approval: confirm the target path and that it is not a user directory.',
    }
  }

  if (GIT_FORCE_PUSH.test(text)) {
    return { action: 'ask', reason: '`git push --force` overwrites remote history; prefer --force-with-lease or approve explicitly.' }
  }

  if (SQL_DESTRUCTIVE.test(text)) {
    return { action: 'ask', reason: 'Destructive SQL (DROP / TRUNCATE) needs human approval.' }
  }

  if (POSIX_POWER.test(text)) {
    return { action: 'ask', reason: 'Shutting down, rebooting, or halting the host needs human approval.' }
  }

  return { action: 'allow', reason: '' }
}

/**
 * Extract the candidate command text from tool arguments.
 * @param args - parsed tool arguments of unknown shape.
 * @returns the joined `command` / `script` / `query` / `sql` fields, or `''`.
 */
export function commandTextFromArguments(args: unknown): string {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return ''
  const parts: string[] = []
  for (const key of ['command', 'script', 'query', 'sql'] as const) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim() !== '') parts.push(value)
  }
  return parts.join('\n')
}

/**
 * Test whether a tool is a shell or database tool whose command text the guard
 * should inspect.
 * @param toolName - the dispatched tool name.
 * @param args - parsed tool arguments.
 * @returns whether the name matches a shell/database family or carries command text.
 */
export function isShellTool(toolName: string, args: unknown): boolean {
  if (/pwsh|bash|cmd|shell|powershell|sql|db/i.test(toolName)) return true
  return commandTextFromArguments(args) !== ''
}

/** Action a user-authored rule may select. `allow` is deliberately absent: a user rule never disables a check. */
export type ReviewAction = 'deny' | 'ask'

/** One case-insensitive substring check from the settings document. */
export interface KeywordRule {
  /** Substring matched case-insensitively against the whole command text. */
  text: string
  /** Action when the substring occurs. */
  action: ReviewAction
  /** Model-facing reason; empty falls back to a generated one. */
  reason: string
}

/** One regular-expression check from the settings document. */
export interface PatternRule {
  /** Expression source, compiled with the `i` flag. */
  pattern: string
  /** Action when the expression matches. */
  action: ReviewAction
  /** Model-facing reason; empty falls back to a generated one. */
  reason: string
}

/** User layer of the rule set, compiled once per settings change. */
export interface CompiledUserRules {
  /** Substring checks, in settings order. */
  keywords: readonly KeywordRule[]
  /** Compiled regular-expression checks, in settings order. */
  patterns: readonly { action: ReviewAction; reason: string; regexp: RegExp }[]
}

/**
 * Compile the user layer.
 * @param keywords - substring checks from the settings document.
 * @param patterns - regular-expression checks from the settings document.
 * @returns the compiled user layer.
 * @throws when a non-empty pattern is not a compilable regular expression; the
 * settings owner validates the same way, so this throw is a load-time backstop.
 */
export function compileUserRules(keywords: readonly KeywordRule[], patterns: readonly PatternRule[]): CompiledUserRules {
  return {
    keywords,
    patterns: patterns
      .filter(rule => rule.pattern !== '')
      .map(rule => ({ action: rule.action, reason: rule.reason, regexp: new RegExp(rule.pattern, 'i') })),
  }
}

/** Default reason for a matched user rule that declares none. */
function userRuleReason(subject: string, action: ReviewAction): string {
  return action === 'deny'
    ? `Blocked by a user rule matching \`${subject}\`.`
    : `A user rule matching \`${subject}\` requires approval.`
}

/**
 * Evaluate the user layer against one command. Deny beats ask; the first
 * matching rule at the strongest action wins, so no later rule can soften it.
 * @param command - full command text.
 * @param rules - compiled user layer.
 * @returns the strongest user verdict, or `undefined` when nothing matched.
 */
export function evaluateUserRules(command: string, rules: CompiledUserRules): CommandVerdict | undefined {
  let ask: CommandVerdict | undefined
  for (const rule of rules.keywords) {
    if (rule.text === '' || !command.toLowerCase().includes(rule.text.toLowerCase())) continue
    const verdict: CommandVerdict = { action: rule.action, reason: rule.reason || userRuleReason(rule.text, rule.action) }
    if (rule.action === 'deny') return verdict
    ask ??= verdict
  }
  for (const rule of rules.patterns) {
    if (!rule.regexp.test(command)) continue
    const verdict: CommandVerdict = { action: rule.action, reason: rule.reason || userRuleReason(rule.regexp.source, rule.action) }
    if (rule.action === 'deny') return verdict
    ask ??= verdict
  }
  return ask
}

/**
 * Merge the built-in verdict with the user layer under the guard's fixed
 * precedence: built-in deny > user deny > user ask > built-in ask > allow.
 * A built-in allow-path exemption therefore loses to any user deny or ask,
 * while a built-in deny is final.
 * @param builtin - verdict from {@link analyzeCommand}.
 * @param user - verdict from {@link evaluateUserRules}, when one matched.
 * @returns the merged verdict.
 */
export function mergeVerdicts(builtin: CommandVerdict, user: CommandVerdict | undefined): CommandVerdict {
  if (builtin.action === 'deny') return builtin
  if (user !== undefined) return user
  return builtin
}
