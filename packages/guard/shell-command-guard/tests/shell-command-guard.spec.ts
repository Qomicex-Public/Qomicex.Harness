/**
 * Behavior suite for @deepseek-ai/dsh-shell-command-guard: the pure rule verdicts
 * (built-in deny/ask/allow, user keyword and pattern layers, merge precedence),
 * the restricted inline check script, the durable settings document, and the
 * same gate driven end-to-end through a real ToolRuntime — where a deny/ask
 * must surface as the dispatch error, a downstream deny must survive, and the
 * Security Review settings must take effect live.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import * as shellCommandGuard from '@deepseek-ai/dsh-shell-command-guard'
import {
  analyzeCommand, commandTextFromArguments, compileUserRules, evaluateUserRules, expandPathRefs, isShellTool,
  matchesAllowPath, mergeVerdicts,
} from '@deepseek-ai/dsh-shell-command-guard/src/rules.ts'
import type { KeywordRule, PatternRule } from '@deepseek-ai/dsh-shell-command-guard/src/rules.ts'
import { compileCheckScript } from '@deepseek-ai/dsh-shell-command-guard/src/script.ts'
import {
  defaultSecurityReviewSettings, SECURITY_REVIEW_NAMESPACE, validateSecurityReviewSettings,
} from '@deepseek-ai/dsh-shell-command-guard/src/settings.ts'
import type { SecurityReviewSettings } from '@deepseek-ai/dsh-shell-command-guard/src/settings.ts'

const signal = new AbortController().signal
const HOME = 'C:\\Users\\tester'
let callSequence = 0

/** A resolved allow-path set identical to the shipped default plus one custom root. */
const ALLOW = {
  allowPaths: [...shellCommandGuard.DEFAULT_ALLOW_PATHS, 'C:\\Project\\build-cache'],
  home: HOME,
}

/** In-memory settings provider: the smallest real provider a test can mount. */
class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  doc: Record<string, unknown>

  /**
   * @param ctx - owning context.
   * @param options - initial document.
   */
  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

describe('analyzeCommand deny verdicts', () => {
  const denied: [string, string][] = [
    ['Remove-Item $home -Recurse -Force', 'PowerShell home delete'],
    ['Remove-Item $HOME -Recurse -Force', 'uppercase home delete'],
    ['Remove-Item $env:USERPROFILE -Recurse -Force', 'profile delete'],
    ['Remove-Item C:\\Users\\tester -Recurse -Force', 'explicit user folder'],
    ['Remove-Item C:\\Users\\* -Recurse -Force', 'users wildcard'],
    ['Remove-Item C:\\ -Recurse -Force', 'drive root'],
    ['rm -rf /', 'POSIX root'],
    ['rm -rf ~', 'POSIX tilde home'],
    ['rm -rf $HOME', 'POSIX home env'],
    ['Remove-Item ~\\.qomicex -Recurse -Force', 'harness home'],
    ['Remove-Item C:\\Users\\tester\\docs C:\\Users -Recurse -Force', 'second users target after a bounded one'],
    ['format C:', 'format drive'],
    ['Format-Volume -DriveLetter C', 'Format-Volume'],
    ['diskpart', 'diskpart'],
    ['mkfs.ext4 /dev/sda1', 'mkfs'],
    ['dd if=/dev/zero of=/dev/sda', 'raw device write'],
    [':(){ :|:& };:', 'fork bomb'],
    ['kill -9 -1', 'kill all'],
    ['chmod -R 777 /', 'recursive root chmod'],
  ]

  it.each(denied)('denies %j (%s)', (command) => {
    expect(analyzeCommand(command, ALLOW).action).toBe('deny')
  })

  it('keeps the deny when an allowed cache root is deleted alongside the user home', () => {
    const verdict = analyzeCommand('Remove-Item $env:USERPROFILE\\.cargo\\registry, $env:USERPROFILE -Recurse -Force', ALLOW)
    expect(verdict.action).toBe('deny')
  })
})

describe('analyzeCommand ask and allow verdicts', () => {
  const asked: [string, string][] = [
    ['Remove-Item .\\node_modules -Recurse -Force', 'project node_modules'],
    ['rm -rf ./dist', 'POSIX relative delete'],
    ['rm -rf /tmp/build', 'POSIX non-home temp'],
    ['git push --force origin main', 'git force push'],
    ['DROP TABLE users', 'destructive SQL'],
    ['shutdown /s /t 0', 'shutdown'],
    ['reboot', 'reboot'],
  ]

  it.each(asked)('asks before running %j (%s)', (command) => {
    expect(analyzeCommand(command, ALLOW).action).toBe('ask')
  })

  const allowed: [string, string][] = [
    ['git push --force-with-lease origin main', 'lease push'],
    ['Remove-Item .\\src\\old.ts', 'bounded delete without recurse/force'],
    ['Get-ChildItem -Recurse', 'recursive listing'],
    ['SELECT * FROM users', 'select'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['Remove-Item $env:USERPROFILE\\.cargo\\registry\\crate -Recurse -Force', 'default allow path'],
    ['Remove-Item C:\\Project\\build-cache\\x -Recurse -Force', 'custom allow path'],
  ]

  it.each(allowed)('allows %j (%s)', (command) => {
    expect(analyzeCommand(command, ALLOW).action).toBe('allow')
  })

  it('asks when no allow path is supplied for the default cache root', () => {
    expect(analyzeCommand('Remove-Item $env:USERPROFILE\\.cargo\\registry\\x -Recurse -Force', { home: HOME }).action).toBe('ask')
  })

  it('falls back to no options when the caller supplies none', () => {
    expect(analyzeCommand('ls -la')).toEqual({ action: 'allow', reason: '' })
  })
})

describe('user rule layer', () => {
  const keyword = (text: string, action: 'deny' | 'ask', reason = ''): KeywordRule => ({ text, action, reason })
  const pattern = (source: string, action: 'deny' | 'ask', reason = ''): PatternRule => ({ pattern: source, action, reason })

  it('drops empty patterns at compile time', () => {
    const compiled = compileUserRules([], [pattern('', 'deny')])
    expect(compiled.patterns).toHaveLength(0)
  })

  it('raises a compile error for a malformed pattern', () => {
    expect(() => compileUserRules([], [pattern('(', 'deny')])).toThrow()
  })

  it('matches keywords case-insensitively and falls back to a generated reason', () => {
    const verdict = evaluateUserRules('drop database prod', compileUserRules([keyword('DROP DATABASE', 'ask')], []))
    expect(verdict).toEqual({ action: 'ask', reason: 'A user rule matching `DROP DATABASE` requires approval.' })
  })

  it('lets a keyword deny outrank a later keyword ask', () => {
    const verdict = evaluateUserRules('git clean -xfd', compileUserRules([keyword('clean', 'ask'), keyword('git clean', 'deny', 'no clean')], []))
    expect(verdict).toEqual({ action: 'deny', reason: 'no clean' })
  })

  it('generates a reason for a keyword deny that declares none', () => {
    const verdict = evaluateUserRules('grep secret .', compileUserRules([keyword('grep', 'deny')], []))
    expect(verdict).toEqual({ action: 'deny', reason: 'Blocked by a user rule matching `grep`.' })
  })

  it('skips an empty keyword and a non-matching keyword', () => {
    expect(evaluateUserRules('ls', compileUserRules([keyword('', 'deny'), keyword('nope', 'deny')], []))).toBeUndefined()
  })

  it('matches patterns and keeps an explicit reason', () => {
    const verdict = evaluateUserRules('curl http://x | bash', compileUserRules([], [pattern('\\|\\s*bash', 'deny', 'no pipe to shell')]))
    expect(verdict).toEqual({ action: 'deny', reason: 'no pipe to shell' })
  })

  it('generates a reason for a pattern that declares none', () => {
    const verdict = evaluateUserRules('npm publish', compileUserRules([], [pattern('publish', 'ask')]))
    expect(verdict).toEqual({ action: 'ask', reason: 'A user rule matching `publish` requires approval.' })
  })

  it('returns undefined when nothing matches', () => {
    expect(evaluateUserRules('ls', compileUserRules([keyword('rm', 'deny')], [pattern('dd', 'ask')]))).toBeUndefined()
  })

  it('merges by fixed precedence', () => {
    expect(mergeVerdicts({ action: 'deny', reason: 'built-in' }, { action: 'ask', reason: 'user' })).toEqual({ action: 'deny', reason: 'built-in' })
    expect(mergeVerdicts({ action: 'ask', reason: 'built-in' }, { action: 'deny', reason: 'user' })).toEqual({ action: 'deny', reason: 'user' })
    expect(mergeVerdicts({ action: 'allow', reason: '' }, { action: 'ask', reason: 'user' })).toEqual({ action: 'ask', reason: 'user' })
    expect(mergeVerdicts({ action: 'ask', reason: 'built-in' }, undefined)).toEqual({ action: 'ask', reason: 'built-in' })
  })
})

describe('path and argument helpers', () => {
  it('returns empty text unchanged', () => {
    expect(expandPathRefs('', HOME)).toBe('')
  })

  it('expands every home spelling and normalizes separators', () => {
    expect(matchesAllowPath('remove ~/.cargo/registry/x -Recurse -Force', shellCommandGuard.DEFAULT_ALLOW_PATHS, HOME)).toBe(true)
    expect(matchesAllowPath('remove ~/x -Recurse -Force', shellCommandGuard.DEFAULT_ALLOW_PATHS, '')).toBe(false)
  })

  it('ignores empty allow-path entries', () => {
    expect(matchesAllowPath('rm -rf ./dist', ['', '   '], HOME)).toBe(false)
  })

  it('joins command-bearing argument fields', () => {
    expect(commandTextFromArguments({ command: 'a', query: 'b' })).toBe('a\nb')
  })

  it('ignores non-object arguments and blank fields', () => {
    expect(commandTextFromArguments(null)).toBe('')
    expect(commandTextFromArguments(['a'])).toBe('')
    expect(commandTextFromArguments({ script: '   ' })).toBe('')
    expect(commandTextFromArguments({ other: 'x' })).toBe('')
  })

  it('recognizes shell tool names and command-bearing arguments', () => {
    expect(isShellTool('bash', {})).toBe(true)
    expect(isShellTool('pwsh', {})).toBe(true)
    expect(isShellTool('sql', {})).toBe(true)
    expect(isShellTool('probe', { command: 'ls' })).toBe(true)
    expect(isShellTool('probe', { other: 1 })).toBe(false)
  })
})

describe('inline check script', () => {
  const reporter = (): { errors: string[]; report: (message: string) => void } => {
    const errors: string[] = []
    return { errors, report: (message) => { errors.push(message) } }
  }

  it('compiles a blank body to a no-op', () => {
    const { errors, report } = reporter()
    expect(compileCheckScript('   ', report)('ls', { home: HOME })).toBeUndefined()
    expect(errors).toEqual([])
  })

  it('reports a compile error and stays inert', () => {
    const { errors, report } = reporter()
    const script = compileCheckScript('return {', report)
    expect(errors[0]).toContain('failed to compile')
    expect(script('ls', { home: HOME })).toBeUndefined()
  })

  it('runs a deny verdict and receives the command and context', () => {
    const { report } = reporter()
    const script = compileCheckScript('if (command.includes("secret")) return { action: "deny", reason: context.home }', report)
    expect(script('read secret', { home: HOME })).toEqual({ action: 'deny', reason: HOME })
  })

  it('runs an ask verdict and defaults a missing reason to empty', () => {
    const { report } = reporter()
    expect(compileCheckScript('return { action: "ask" }', report)('ls', { home: HOME })).toEqual({ action: 'ask', reason: '' })
  })

  it('treats allow and undefined as no opinion', () => {
    const { report } = reporter()
    expect(compileCheckScript('return { action: "allow" }', report)('ls', { home: HOME })).toBeUndefined()
    expect(compileCheckScript('return undefined', report)('ls', { home: HOME })).toBeUndefined()
  })

  it('reports a non-object result', () => {
    const { errors, report } = reporter()
    expect(compileCheckScript('return 7', report)('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('instead of a verdict object')
  })

  it('reports an unknown action', () => {
    const { errors, report } = reporter()
    expect(compileCheckScript('return { action: "maybe" }', report)('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('unknown action')
  })

  it('reports an unreadable verdict object', () => {
    const { errors, report } = reporter()
    const script = compileCheckScript('return Object.defineProperty({}, "action", { get() { throw new Error("trap") } })', report)
    expect(script('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('unreadable verdict')
  })

  it('contains a script that throws', () => {
    const { errors, report } = reporter()
    expect(compileCheckScript('throw new Error("boom")', report)('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('boom')
  })

  it('contains a script that throws a value with a hostile toString', () => {
    const { errors, report } = reporter()
    const script = compileCheckScript('throw { toString() { throw new Error("inner") } }', report)
    expect(script('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('unprintable thrown value')
  })

  it('abandons a runaway script at the time limit', () => {
    const { errors, report } = reporter()
    expect(compileCheckScript('while (true) {}', report)('ls', { home: HOME })).toBeUndefined()
    expect(errors[0]).toContain('failed')
  })
})

describe('settings document', () => {
  it('defaults to enabled with empty user layers', () => {
    expect(defaultSecurityReviewSettings()).toEqual({ enabled: true, allowPaths: [], keywords: [], rules: [], script: '' })
  })

  it('accepts a compilable rule set', () => {
    const value: SecurityReviewSettings = { ...defaultSecurityReviewSettings(), rules: [{ pattern: 'rm\\s+-rf', action: 'ask', reason: '' }] }
    expect(() => { validateSecurityReviewSettings(value) }).not.toThrow()
  })

  it('rejects a malformed pattern', () => {
    const value: SecurityReviewSettings = { ...defaultSecurityReviewSettings(), rules: [{ pattern: '(', action: 'ask', reason: '' }] }
    expect(() => { validateSecurityReviewSettings(value) }).toThrow(/valid regular expression/)
  })
})

/** A `bash` tool fixture the gate inspects. */
const bashTool = defineContentToolFixture({
  name: 'bash',
  description: 'shell',
  parameters: { command: { type: 'string', required: true } },
  async execute() { return [{ type: 'text' as const, text: 'ran' }] },
})

/**
 * Mount the tools registry plus the guard, optionally behind a settings
 * provider seeded with a document.
 * @param doc - provider document; omitted mounts no settings provider at all.
 * @returns the context, with the provider when one was mounted.
 */
async function mount(doc?: Record<string, unknown>): Promise<{ ctx: Context; settings: MemorySettings | undefined }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  let settings: MemorySettings | undefined
  if (doc !== undefined) {
    await ctx.plugin(MemorySettings, { doc })
    settings = ctx.get('settings') as MemorySettings
  }
  await ctx.plugin(shellCommandGuard)
  ctx.tools.register(bashTool)
  return { ctx, settings }
}

/** Dispatch one command through the running gate. */
async function run(ctx: Context, command: string) {
  callSequence += 1
  return await ctx.tools.execute({ signal, callId: ToolCallId(`c${String(callSequence)}`), name: 'bash', arguments: { command } })
}

describe('gate through the tools pipeline', () => {
  it('turns a deny verdict into the dispatch error', async () => {
    const { ctx } = await mount()
    const result = await run(ctx, 'rm -rf /')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('[shell-command-guard]')
    expect(result.error?.message).toContain('blocked')
  })

  it('turns an ask verdict into the dispatch error when no approval seam is mounted', async () => {
    const { ctx } = await mount()
    const result = await run(ctx, 'git push --force')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('overwrites remote history')
  })

  it('allows an ordinary command through unchanged', async () => {
    const { ctx } = await mount()
    expect((await run(ctx, 'ls -la')).isError).toBe(false)
  })

  it('leaves a non-shell tool with no command text untouched', async () => {
    const { ctx } = await mount()
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text' as const, text: 'ok' }] } }))
    callSequence += 1
    const result = await ctx.tools.execute({ signal, callId: ToolCallId(`c${String(callSequence)}`), name: 'probe', arguments: {} })
    expect(result.isError).toBe(false)
  })

  it('keeps a downstream deny when this guard would only ask', async () => {
    const { ctx } = await mount()
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === 'bash') return { kind: 'deny', reason: 'downstream sealed it' }
      return next()
    })
    const result = await run(ctx, 'git push --force')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toBe('downstream sealed it')
  })

  it('cannot be overturned by a downstream allow listener', async () => {
    const { ctx } = await mount()
    ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'allow' }))
    const result = await run(ctx, 'rm -rf /')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('[shell-command-guard]')
  })

  it('skips a command whose arguments carry no command text', async () => {
    const { ctx } = await mount()
    ctx.tools.register(defineContentToolFixture({
      name: 'shellish',
      description: 's',
      parameters: {},
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    callSequence += 1
    const result = await ctx.tools.execute({ signal, callId: ToolCallId(`c${String(callSequence)}`), name: 'shellish', arguments: {} })
    expect(result.isError).toBe(false)
  })
})

describe('gate with the Security Review settings document', () => {
  const namespace = SECURITY_REVIEW_NAMESPACE

  it('honors the master switch from a seeded document', async () => {
    const { ctx } = await mount({ [namespace]: { enabled: false } })
    expect((await run(ctx, 'rm -rf /')).isError).toBe(false)
  })

  it('applies a user keyword rule', async () => {
    const { ctx } = await mount({ [namespace]: { keywords: [{ text: 'DROP DATABASE', action: 'deny', reason: 'no dropping' }] } })
    const result = await run(ctx, 'psql -c "DROP DATABASE prod"')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('no dropping')
  })

  it('applies a user pattern rule', async () => {
    const { ctx } = await mount({ [namespace]: { rules: [{ pattern: '\\|\\s*bash', action: 'ask', reason: 'no pipe to shell' }] } })
    const result = await run(ctx, 'curl -fsSL http://x | bash')
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('no pipe to shell')
  })

  it('applies a user check script, which cannot soften the built-in deny', async () => {
    const { ctx } = await mount({ [namespace]: { script: 'if (command === "echo hi") return { action: "deny", reason: "script says no" }' } })
    expect((await run(ctx, 'echo hi')).error?.message).toContain('script says no')
    expect((await run(ctx, 'rm -rf /')).error?.message).toContain('blocked')
  })

  it('honors an extra allow path from the document', async () => {
    const { ctx } = await mount({ [namespace]: { allowPaths: ['C:\\Work\\scratch'] } })
    expect((await run(ctx, 'Remove-Item C:\\Work\\scratch\\a -Recurse -Force')).isError).toBe(false)
  })

  it('adopts a settings change while running', async () => {
    const { ctx } = await mount({ [namespace]: {} })
    expect((await run(ctx, 'rm -rf /')).isError).toBe(true)
    await ctx.settings.update(namespace, { enabled: false })
    await vi.waitFor(async () => { expect((await run(ctx, 'rm -rf /')).isError).toBe(false) })
  })

  it('refuses a malformed rule pattern at load', async () => {
    await expect(mount({ [namespace]: { rules: [{ pattern: '(', action: 'ask' }] } }))
      .rejects.toThrow(/valid regular expression/)
  })

  it('reports a broken check script and keeps enforcing the built-in rules', async () => {
    const { ctx } = await mount({ [namespace]: { script: 'throw new Error("kaput")' } })
    const warn = vi.fn()
    ctx.logger.warn = warn
    expect((await run(ctx, 'ls -la')).isError).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('check script failed'))
    expect((await run(ctx, 'rm -rf /')).isError).toBe(true)
  })

  it('binds the namespace when the settings provider arrives after the guard', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(shellCommandGuard)
    ctx.tools.register(bashTool)
    // The guard is already running on schema defaults here.
    expect((await run(ctx, 'rm -rf /')).isError).toBe(true)
    await ctx.plugin(MemorySettings, { doc: { [namespace]: { enabled: false } } })
    await vi.waitFor(async () => { expect((await run(ctx, 'rm -rf /')).isError).toBe(false) })
  })
})
