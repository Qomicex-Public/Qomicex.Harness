/**
 * Behavior suite for @deepseek-ai/dsh-sandbox-trust: the service reads the
 * live trusted-command list and judges whether a command runs with host
 * identity. An empty list (the default) trusts nothing, so behavior is
 * unchanged until the user edits the Security Review page; a committed change
 * takes effect on the next call; and the entry opts out of the generated page.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SandboxTrustService from '@deepseek-ai/dsh-sandbox-trust'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'

describe('SandboxTrustService', () => {
  it('trusts no command on the empty default list', async () => {
    const ctx = new Context()
    await liveConfig(ctx, SandboxTrustService)
    expect(ctx.sandboxTrust.isTrustedCommand('cargo build')).toBe(false)
    expect(ctx.sandboxTrust.isTrustedCommand('rm -rf /')).toBe(false)
  })

  it('trusts a listed command and keeps a chained non-listed one confined', async () => {
    const ctx = new Context()
    await liveConfig(ctx, SandboxTrustService, { trustedCommands: ['cargo', 'gh'] })
    expect(ctx.sandboxTrust.isTrustedCommand('cargo build --release')).toBe(true)
    expect(ctx.sandboxTrust.isTrustedCommand('gh pr create')).toBe(true)
    expect(ctx.sandboxTrust.isTrustedCommand('cargo build; rm -rf /')).toBe(false)
    expect(ctx.sandboxTrust.isTrustedCommand('cargofoo')).toBe(false)
  })

  it('adopts a trusted-command change while running', async () => {
    const ctx = new Context()
    const live = await liveConfig(ctx, SandboxTrustService)
    expect(ctx.sandboxTrust.isTrustedCommand('cargo build')).toBe(false)

    await live.update({ trustedCommands: ['cargo'] })

    expect(ctx.sandboxTrust.isTrustedCommand('cargo build')).toBe(true)
  })

  it('opts out of the generated settings page and releases it on disposal', async () => {
    await omitsGeneratedPage(async ctx => (await liveConfig(ctx, SandboxTrustService)).fiber)
  })
})
