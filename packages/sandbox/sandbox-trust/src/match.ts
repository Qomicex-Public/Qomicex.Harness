/**
 * Command-name extraction and whole-token matching for the trusted-command
 * list that lets a named command run with host identity under the file sandbox.
 * Matching is lexical and whole-token by design: every simple command in the
 * source must name a trusted program (case-insensitively, ignoring a Windows
 * executable suffix). The all-segments rule is the safety point — confinement
 * applies to the whole shell string, so "any segment trusted" would let
 * `cargo; rm -rf /` run `rm` with host identity off a single `cargo` grant;
 * requiring each program to be listed blocks that chaining, and `cargo` still
 * cannot match `cargofoo`.
 *
 * @module @deepseek-ai/dsh-sandbox-trust/match
 */

/**
 * Shell command separators split a command source into simple commands: the
 * two-character `&&` and `||`, plus the single characters `;`, `&`, `|`, and
 * line breaks. Ordered so the two-character operators win before their
 * one-character components.
 */
const SEPARATORS = /(?:\|\||&&|[\n\r;|&])/u

/** Windows executable suffixes treated as equivalent to the bare command name. */
const EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|com)$/iu

// ponytail: lexical split, not a shell parser. A quoted argument containing `;`,
// a `$(...)` whose tail is a bare command, or an environment-assignment prefix
// (`FOO=bar cargo`) are known gaps; revisit if security review shows a reachable
// bypass. Word-boundary equality already blocks the near-miss names that matter.

/**
 * Split one shell command source into its simple commands' leading tokens.
 * Taking the first whitespace-delimited field of each separator-bounded segment
 * names the program that runs; later argument tokens are irrelevant to trust.
 * @param commandSource - the exact shell source that will be executed.
 * @returns the leading token of each simple command; empty segments yield empty
 *   strings, which callers ignore.
 */
export function simpleCommandTokens(commandSource: string): string[] {
  return commandSource.split(SEPARATORS).map((segment) => {
    const trimmed = segment.trim()
    const breakAt = trimmed.search(/\s/u)
    return breakAt === -1 ? trimmed : trimmed.slice(0, breakAt)
  })
}

/**
 * Canonical form for comparing a command name: trimmed, lowercased, and with a
 * Windows executable suffix removed, so `Cargo.EXE`, `cargo.exe`, and `Cargo`
 * all compare equal to a `cargo` trust entry.
 * @param name - a command name or trust entry.
 * @returns the canonical comparison key; an empty name stays empty.
 */
export function normalizeCommandName(name: string): string {
  return name.trim().toLowerCase().replace(EXECUTABLE_SUFFIX, '')
}

/**
 * Whether the source runs entirely from trusted programs: EVERY simple
 * command's leading token must equal a trusted entry. An empty trust list, an
 * empty source, a whitespace-only source, or any non-listed program (including
 * one chained after a separator) makes the whole command stay confined.
 * @param commandSource - the exact shell source that will be executed.
 * @param trusted - the user's trusted command names; entries are canonicalized
 *   the same way as the extracted tokens.
 * @returns true when every non-empty command token equals a trusted entry.
 */
export function isTrustedCommand(commandSource: string, trusted: readonly string[]): boolean {
  const wanted = new Set(trusted.map(normalizeCommandName).filter(name => name.length > 0))
  if (wanted.size === 0) return false
  const tokens = simpleCommandTokens(commandSource).map(normalizeCommandName).filter(token => token.length > 0)
  if (tokens.length === 0) return false
  return tokens.every(token => wanted.has(token))
}
