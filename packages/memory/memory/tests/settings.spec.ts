/**
 * Settings integration: the memory config becomes an editable section, and an
 * edit reaches the running plugin without a restart.
 *
 * Uses a real in-memory `SettingsProvider` subclass rather than a stub, so the
 * assertions cover the actual `installSection` contract (attach, live commit,
 * detach) instead of a mock's idea of it.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { registerMemorySettings, MEMORY_SETTINGS_NS } from '../src/settings.ts'
import { Config, resolveConfig } from '../src/config.ts'
import type { Config as MemoryConfig } from '../src/config.ts'

/** In-memory provider: the smallest real subclass that persists somewhere. */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], doc: Record<string, unknown> = {}) {
    super(ctx)
    this.doc = structuredClone(doc)
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
  }
}

/** Register the section the way the plugin does, capturing the live source. */
function install(ctx: Context, entry: MemoryConfig): () => MemoryConfig {
  let current = (): MemoryConfig => entry
  registerMemorySettings(ctx, entry, (source) => {
    current = source
  })
  return () => current()
}

/** The resolved excitability the running plugin would act on. */
function excitability(current: () => MemoryConfig): number | undefined {
  return resolveConfig(current()).thresholds.excitability
}

describe('memory settings section', () => {
  it('registers the bio-memory namespace once a provider mounts', async () => {
    const ctx = new Context()
    const current = install(ctx, Config({}))

    // No provider yet: the composition entry stays authoritative. A synchronous
    // probe would have missed the provider that mounts after the plugin.
    expect(excitability(current)).toBe(0.45)

    await ctx.plugin(MemorySettings, {})
    await vi.waitFor(() => {
      expect(ctx.settings.describe().some(view => view.ns === MEMORY_SETTINGS_NS)).toBe(true)
    })
    await ctx.fiber.dispose()
  })

  it('takes the stored section over the composition entry', async () => {
    const ctx = new Context()
    const current = install(ctx, Config({}))
    await ctx.plugin(MemorySettings, {
      [MEMORY_SETTINGS_NS]: { thresholds: { excitability: 0.9 } },
    })
    await vi.waitFor(() => {
      expect(excitability(current)).toBe(0.9)
    })
    await ctx.fiber.dispose()
  })

  it('reflects a live edit without a restart', async () => {
    const ctx = new Context()
    const current = install(ctx, Config({}))
    await ctx.plugin(MemorySettings, {})
    await vi.waitFor(() => {
      expect(excitability(current)).toBe(0.45)
    })

    await ctx.settings.update(MEMORY_SETTINGS_NS, { thresholds: { excitability: 0.8 } })

    // The thunk is what makes this true: the plugin re-reads the config per
    // operation instead of holding the value captured at construction.
    await vi.waitFor(() => {
      expect(excitability(current)).toBe(0.8)
    })
    await ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the provider detaches', async () => {
    const ctx = new Context()
    const current = install(ctx, Config({ thresholds: { excitability: 0.2, forgetDemote: 0.45, forgetArchive: 0.65, forgetHard: 0.85 } }))
    const fiber = ctx.plugin(MemorySettings, {
      [MEMORY_SETTINGS_NS]: { thresholds: { excitability: 0.9 } },
    })
    await vi.waitFor(() => {
      expect(excitability(current)).toBe(0.9)
    })

    await fiber.dispose()

    await vi.waitFor(() => {
      expect(excitability(current)).toBe(0.2)
    })
    await ctx.fiber.dispose()
  })

  it('runs from the composition entry when no provider ever mounts', async () => {
    const ctx = new Context()
    const current = install(ctx, Config({ thresholds: { excitability: 0.3, forgetDemote: 0.45, forgetArchive: 0.65, forgetHard: 0.85 } }))
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(excitability(current)).toBe(0.3)
    await ctx.fiber.dispose()
  })

  it('passes the plugin schema through unchanged', () => {
    // The settings service parses the section with this schema, so a shape
    // mismatch would only surface at runtime in the UI.
    const resolved = resolveConfig(Config({}))
    expect(resolved.thresholds.excitability).toBe(0.45)
    expect(resolved.bounds.workingCapacity).toBeGreaterThan(0)
  })

  it('ships pattern application off, so nothing is injected until asked', () => {
    // Both the hot-pack patterns section and the scene matcher are off by
    // default. Enabling pattern extraction alone must not put unreviewed
    // regularities in front of the model.
    const resolved = resolveConfig(Config({
      patternExtraction: {
        enabled: true,
        intervalDays: 7,
        requireHumanApproval: true,
        preferenceMinProjects: 3,
        failureMinOccurrences: 2,
        environmentMinProjects: 3,
        pruningEnabled: true,
        pruneMinScore: 0,
        pruneStaleDays: 30,
      },
    }))
    expect(resolved.patternApplication.injectHotPack).toBe(false)
    expect(resolved.patternApplication.sceneMatching).toBe(false)
    expect(resolved.patternApplication.feedbackCollection).toBe(false)
    expect(resolved.patternApplication.matchThreshold).toBeGreaterThan(0)
  })

  it('resolves the pattern-extraction defaults the extractor reads', () => {
    const resolved = resolveConfig(Config({}))
    expect(resolved.patternExtraction.enabled).toBe(false)
    expect(resolved.patternExtraction.requireHumanApproval).toBe(true)
    expect(resolved.patternExtraction.preferenceMinProjects).toBe(3)
    expect(resolved.patternExtraction.failureMinOccurrences).toBe(2)
    expect(resolved.patternExtraction.environmentMinProjects).toBe(3)
  })
})
