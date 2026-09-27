/**
 * Command-trust wiring for `SandboxBashExecutor`: the bash twin of the
 * pwsh command-trust suite. A command whose every program is on the trusted
 * list runs with host identity (the confined provider is never consulted and
 * the result reports `danger-full-access`); a command with any non-listed
 * program, and the no-trust-service default, stay confined. The sandbox
 * provider is a recording fake; bash and the local subprocess runtime are real,
 * and the trusted list mounts the real service under Loader. Skips without bash.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SandboxTrustService from '@deepseek-ai/dsh-sandbox-trust'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import { SandboxBashExecutor } from '../src/index.ts'

function bashAvailable(): boolean {
  return spawnSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0
}

const maybe = bashAvailable() ? it : it.skip

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-bash-sandbox-trust-'))
afterAll(() => {
  rmSync(spillDir, { recursive: true, force: true })
})

/** A passthrough wrap asserting full enforcement; carries the unix denial dialect. */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: ['read-only file system', 'permission denied'], runnerFailureRules: [] })

/**
 * Mount the executor over a recording fake sandbox, the real bash subprocess
 * runtime, and — when given — the real trusted-command service under Loader.
 * @param trustedCommands - the live list to mount; omit to leave the service unmounted.
 */
async function setup(trustedCommands?: string[]) {
  const calls: { argv: string[]; policy: SandboxPolicy }[] = []
  class FakeSandboxProvider extends SandboxProvider {
    async confine(argv: readonly string[], policy: SandboxPolicy): Promise<ConfinedArgv> {
      calls.push({ argv: [...argv], policy })
      return passthrough(argv)
    }
  }
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: spillDir })
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(SandboxBashExecutor, { graceMs: 5000 })
  if (trustedCommands !== undefined) await liveConfig(ctx, SandboxTrustService, { trustedCommands })
  return { ctx, executor: ctx.shell as SandboxBashExecutor, calls }
}

describe('command trust wiring', () => {
  maybe('runs a trusted command with host identity and never confines it', async () => {
    const { ctx, executor, calls } = await setup(['echo'])
    const result = await (await executor.execute(executor.resolve({ command: 'echo trusted' }))).result()
    expect(result.sandbox?.mode).toBe('danger-full-access')
    expect(calls).toHaveLength(0)
    expect(result.stdout.text).toContain('trusted')
    await ctx.fiber.dispose()
  })

  maybe('confines a command whose program is not listed while a list exists', async () => {
    const { ctx, executor, calls } = await setup(['cargo'])
    const result = await (await executor.execute(executor.resolve({ command: 'echo unlisted' }))).result()
    expect(result.sandbox?.mode).toBe('workspace-write')
    expect(calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  maybe('confines every command when no trust service is mounted', async () => {
    const { ctx, executor, calls } = await setup()
    await (await executor.execute(executor.resolve({ command: 'echo plain' }))).result()
    expect(calls).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
