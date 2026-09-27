/**
 * Approval-gated sandbox trust growth. The agent asks through `sandbox_trust`,
 * the user decides through the harness approval channel, and an approved
 * addition is written to the deployment's own settings namespace — the same
 * document the Security Review settings page edits — so it persists and takes
 * effect on the next confined call. Removal stays a user action on that page.
 *
 * @module @deepseek-ai/dsh-tool-trust
 */

import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeCommandName, simpleCommandTokens } from '@deepseek-ai/dsh-sandbox-trust'
// Type-only: merges the optional services this tool reads through `ctx.get`.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-user-approval'

/** Stable Loader identity. */
export const name = 'tool-trust'

/** Services this plugin requires; the rest are read optionally through `ctx.get`. */
export const inject = ['tools']

/** Settings namespace of the trusted-command list. */
const TRUST_NAMESPACE = 'sandbox-trust'

/** Settings namespace of the extra writable roots. */
const POLICY_NAMESPACE = 'sandbox-policy'

/** What one call asks to trust. */
type TrustKind = 'command' | 'path'

/**
 * Register the approval-gated trust-growth tool.
 * @param ctx - plugin context; only `ctx.tools` is a required service.
 */
export function apply(ctx: Context): void {
  /** The stored form of a command entry, or a throw when the value is not exactly one program name. */
  const canonicalCommand = (value: string): string => {
    const tokens = simpleCommandTokens(value)
    const [only] = tokens
    if (tokens.length !== 1 || only === undefined || only !== value || normalizeCommandName(only) === '') {
      throw new Error('sandbox_trust: a trusted command must be a single program name such as "cargo" or "gh" — no arguments and no chained commands; add each program separately')
    }
    return normalizeCommandName(value)
  }

  /** The stored form of a path entry, or a throw when it is not an existing absolute directory. */
  const absoluteDirectory = (value: string): string => {
    if (!isAbsolute(value)) throw new Error('sandbox_trust: a trusted path must be an absolute directory path')
    if (!existsSync(value)) throw new Error(`sandbox_trust: ${value} does not exist yet; create the directory and ask again`)
    return value
  }

  /** The live entries of one kind, or a throw when the owning service is not mounted. */
  const currentEntries = (kind: TrustKind): readonly string[] => {
    if (kind === 'command') {
      const trust = ctx.get('sandboxTrust')
      if (trust === undefined) throw new Error('sandbox_trust: command trust is not available in this deployment')
      return trust.trustedCommands()
    }
    const policy = ctx.get('sandboxPolicy')
    if (policy === undefined) throw new Error('sandbox_trust: path trust is not available in this deployment')
    return policy.extraWritableRoots()
  }

  /** The audit-level consequence of one entry, stated for the approval log. */
  const approvalEffect = (kind: TrustKind, entry: string): string => kind === 'command'
    ? `run every command line containing \`${entry}\` with the user's full host identity, able to read and write any file and credential without the file sandbox`
    : `let confined shell and file operations create, modify, and delete anything under \`${entry}\` outside the session workspace`

  ctx.tools.register(defineTool({
    name: 'sandbox_trust',
    description: "Ask the user to add a command or directory to this deployment's sandbox trust list. "
      + "A trusted command runs with the user's full host identity, which tools that read host credentials need (for example gh or cargo); "
      + 'a trusted directory becomes writable outside the session workspace. '
      + 'Every addition asks the user first, and the user can remove entries later in Settings → Security review.',
    parameters: {
      kind: {
        type: 'string', required: true, enum: ['command', 'path'],
        description: 'What to trust: a command program name, or a directory path.',
      },
      value: {
        type: 'string', required: true,
        description: 'For a command: a single program name such as `cargo`, `gh`, or `cargo.exe` — no arguments and no chained commands; add each program separately. For a path: an absolute directory path.',
      },
      reason: {
        type: 'string', required: true,
        description: 'One sentence for the user explaining why this entry needs trust; it appears in the approval prompt.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          entry: { type: 'string', required: true },
          added: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('sandbox_trust requires an agent Session')
      const kind: TrustKind = args.kind === 'path' ? 'path' : 'command'
      const raw = args.value.trim()
      const entry = kind === 'command' ? canonicalCommand(raw) : absoluteDirectory(raw)
      const field = kind === 'command' ? 'trustedCommands' : 'extraWritableRoots'
      const namespace = kind === 'command' ? TRUST_NAMESPACE : POLICY_NAMESPACE

      const current = currentEntries(kind)
      if (current.includes(entry)) {
        const message = `${entry} is already on the ${kind} trust list; nothing changed.`
        return { kind, entry, added: false, message }
      }

      const approval = ctx.get('approval')
      if (approval === undefined) throw new Error('sandbox_trust requires an approval channel, but none is composed')
      const outcome = await approval.request({
        agent: exec.agent,
        toolName: 'sandbox_trust',
        callId: exec.callId,
        reason: `add ${entry} to the sandbox ${kind} trust list so it may ${approvalEffect(kind, entry)}. The model's reason: ${args.reason}`,
        displayReason: kind === 'command'
          ? {
            en: `Allow \`${entry}\` to run with the user's full host identity (any file and credential): ${args.reason}`,
            zh: `允许 \`${entry}\` 以用户完整主机身份运行（可读写任意文件与凭据）：${args.reason}`,
          }
          : {
            en: `Allow writing to \`${entry}\` outside the session workspace: ${args.reason}`,
            zh: `允许在会话工作区之外写入 \`${entry}\`：${args.reason}`,
          },
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') {
        throw new Error(
          outcome === 'rejected'
            ? 'the user rejected adding this entry to the sandbox trust list; it was not added, so stop and explain instead of working around it'
            : outcome === 'cancelled'
              ? 'the approval to add this entry to the sandbox trust list was cancelled'
              : 'sandbox_trust requires an approval channel, but none is available',
        )
      }

      const settings = ctx.get('settings')
      if (settings === undefined) throw new Error('sandbox_trust requires a settings service to persist the entry, but none is composed')
      await settings.mutate(namespace, [{ op: 'set', path: [field], value: [...current, entry] }])
      const message = `Added ${entry} to the ${kind} trust list. It takes effect on the next confined call; the user can remove it in Settings → Security review.`
      return { kind, entry, added: true, message }
    },
  }))
}
