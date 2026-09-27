/**
 * Command-trust wiring for `SandboxPwshExecutor`: a command whose every
 * program is on the trusted list runs with host identity — the confined
 * provider is never consulted and the result reports `danger-full-access` —
 * while a command with any non-listed program (and the no-trust-service
 * default) stays confined. The sandbox provider is a recording fake; pwsh and
 * the local subprocess runtime are real, and the trusted list mounts the real
 * service under Loader. Skips without pwsh, matching this package's other
 * suites.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SandboxTrustService from '@deepseek-ai/dsh-sandbox-trust'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import { SandboxPwshExecutor } from '../src/index.ts'

function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8', stdio: 'ignore' }).status === 0
}

const maybe = pwshAvailable() ? it : it.skip

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-trust-'))
afterAll(() => {
  rmSync(spillDir, { recursive: true, force: true })
})

/** A passthrough wrap asserting full enforcement; carries the pwsh denial dialect. */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: ['access is denied', 'access to the path'], runnerFailureRules: [] })

/**
 * Mount the executor over a recording fake sandbox, the real pwsh subprocess
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
  await ctx.plugin(SandboxPwshExecutor, { graceMs: 5000 })
  if (trustedCommands !== undefined) await liveConfig(ctx, SandboxTrustService, { trustedCommands })
  return { ctx, executor: ctx.shell as SandboxPwshExecutor, calls }
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
