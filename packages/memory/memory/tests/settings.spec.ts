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
import type { Config as MemoryConfig, ResolvedConfig } from '../src/config.ts'
import { DEFAULT_JUDGE_MODEL_PATH, ALL_GPU_LAYERS } from '../src/algorithms/local-judge.ts'

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

/** The local-model group with one field overridden, so a test names only what it changes. */
function localLlm(overrides: Partial<ResolvedConfig['judgment']['localLlm']> = {}): ResolvedConfig['judgment']['localLlm'] {
  return {
    enabled: false,
    autoDownload: false,
    modelPath: '',
    modelVersion: '',
    promptVersion: 'v1',
    gpuLayers: 0,
    contextSize: 2048,
    ...overrides,
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
    expect(resolved.capacity.workingMemorySlots).toBeGreaterThan(0)
  })

  it('ships the design document\u2019s staging capacity of 500', () => {
    // The document raises it from the 128 the first cut carried; a store that
    // admits more per session needs the room to hold what it admits.
    expect(resolveConfig(Config({})).capacity.stagingPoolCapacity).toBe(500)
  })

  it('ships the offline pattern layers on, gated by human approval', () => {
    // Extraction and application both default on. An unreviewed regularity
    // still never reaches the model: the hot-pack section and the scene
    // matcher read `state === 'active'` (index.ts:672), and a pattern only
    // becomes active through approval, which is why `requireHumanApproval`
    // stays true rather than defaulting off with the layers.
    const resolved = resolveConfig(Config({
      patternExtraction: {
        enabled: true,
        schedule: 'weekly',
        requireHumanApproval: true,
        thresholds: {
          preferenceMinProjects: 3,
          failureMinOccurrences: 2,
          environmentMinProjects: 3,
          workflowMinOccurrences: 5,
        },
        pruning: { enabled: true, minScore: 0, staleDays: 30 },
      },
    }))
    expect(resolved.patternApplication.injectHotPack).toBe(true)
    expect(resolved.patternApplication.sceneMatching).toBe(true)
    expect(resolved.patternApplication.feedbackCollection).toBe(true)
    expect(resolved.patternApplication.matchThreshold).toBeGreaterThan(0)
  })

  it('resolves the pattern-extraction defaults the extractor reads', () => {
    const resolved = resolveConfig(Config({}))
    expect(resolved.patternExtraction.enabled).toBe(true)
    expect(resolved.patternExtraction.requireHumanApproval).toBe(true)
    expect(resolved.patternExtraction.schedule).toBe('weekly')
    expect(resolved.patternExtraction.thresholds.preferenceMinProjects).toBe(3)
    expect(resolved.patternExtraction.thresholds.failureMinOccurrences).toBe(2)
    expect(resolved.patternExtraction.thresholds.environmentMinProjects).toBe(3)
    expect(resolved.patternExtraction.thresholds.workflowMinOccurrences).toBe(5)
  })

  it('resolves the retention switches the document lists', () => {
    const resolved = resolveConfig(Config({}))
    expect(resolved.retention.archiveOnExpiry).toBe(true)
    expect(resolved.retention.structuralException).toBe(true)
    expect(resolved.retention.enableAdjacency).toBe(true)
    expect(resolved.retention.enableMention).toBe(true)
    expect(resolved.retention.adjacencyThreshold).toBeGreaterThan(0)
  })

  it('resolves the curation budget and rebuild knobs the document lists', () => {
    const resolved = resolveConfig(Config({}))
    expect(resolved.curation.schedule).toBe('weekly')
    expect(resolved.curation.batchPolicy.outputRatio).toBeGreaterThan(0)
    expect(resolved.curation.fullRebuild.everyNIncrementalRuns).toBeGreaterThan(0)
    expect(resolved.curation.budget.maxRunsPerMonth).toBeGreaterThan(0)
  })

  it('resolves the judgment knobs the document lists', () => {
    const resolved = resolveConfig(Config({}))
    expect(resolved.judgment.ruleEngine.mode).toBe('relaxed')
    expect(resolved.judgment.localLlm.autoDownload).toBe(false)
    expect(resolved.judgment.localLlm.promptVersion).toBe('v1')
  })

  it('offloads every layer by default so the judge does not run on CPU', () => {
    // A judge that runs per user message on CPU took 86 s for one answer
    // against 3-5 s on a GPU, which is enough to make the machine unusable.
    // The default is therefore full offload; llama.cpp ignores the count on a
    // machine with no GPU, so this stays correct without any detection.
    expect(resolveConfig(Config({})).judgment.localLlm.gpuLayers).toBe(ALL_GPU_LAYERS)
  })

  it('keeps an explicit zero, which is how a user forces CPU', () => {
    const resolved = resolveConfig(Config({
      judgment: {
        ruleEngine: { mode: 'relaxed' },
        localLlm: localLlm({ gpuLayers: 0 }),
      },
    }))
    expect(resolved.judgment.localLlm.gpuLayers).toBe(0)
  })

  it('fills the default model path so an empty one still names somewhere', () => {
    // The document's configuration lists no model path at all, so the resolved
    // config has to name the default location itself. An empty path reaching
    // the downloader is what made the button fail with "set a model file path
    // first" on a fresh deployment.
    const resolved = resolveConfig(Config({
      judgment: { ruleEngine: { mode: 'relaxed' }, localLlm: localLlm({ modelPath: '' }) },
    }))
    expect(resolved.judgment.localLlm.modelPath).toBe(DEFAULT_JUDGE_MODEL_PATH)
    expect(resolved.judgment.localLlm.modelPath).not.toBe('')
  })

  it('keeps an explicit model path', () => {
    const resolved = resolveConfig(Config({
      judgment: {
        ruleEngine: { mode: 'relaxed' },
        localLlm: localLlm({ modelPath: 'D:/weights/judge.gguf' }),
      },
    }))
    expect(resolved.judgment.localLlm.modelPath).toBe('D:/weights/judge.gguf')
  })

  it('resolves the toolkit integration as a tri-state', () => {
    expect(resolveConfig(Config({})).integrations.toolkit.enabled).toBe('auto')
  })
})
