/**
 * Volatile config resolution: the loader hands `apply` a config whose leaves
 * are stable references, and `resolveConfig` unwraps each snapshot into the
 * plain values the runtime reads. A schema default rides inside the
 * reference, so no leaf needs a fallback after unwrapping.
 */

import { createVolatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'
import type { Config as MemoryConfig } from '../src/config.ts'
import { ALL_GPU_LAYERS, DEFAULT_JUDGE_MODEL_PATH } from '../src/algorithms/local-judge.ts'

describe('resolveConfig', () => {
  it('unwraps the schema defaults into plain values', () => {
    // A reference left wrapped would arrive here as an object, so a plain
    // number is also the proof that the unwrap happened.
    const resolved = resolveConfig(Config({}))
    expect(resolved.thresholds.excitability).toBe(0.45)
    expect(resolved.capacity.stagingPoolCapacity).toBe(500)
    expect(resolved.judgment.localLlm.gpuLayers).toBe(ALL_GPU_LAYERS)
    expect(resolved.integrations.toolkit.enabled).toBe('auto')
  })

  it('reads the snapshot each reference currently holds', () => {
    // An edit commits into the same references the plugin already holds, so
    // resolving again has to observe the new value, not the schema default.
    const validated = Config({})
    const resolved = resolveConfig({
      ...validated,
      patternApplication: {
        ...validated.patternApplication,
        matchThreshold: createVolatile(0.75),
      },
    })
    expect(resolved.patternApplication.matchThreshold).toBe(0.75)
  })

  it('fills the default model path so an empty one still names somewhere', () => {
    // An empty path reaching the downloader is what made the button fail with
    // "set a model file path first" on a fresh deployment.
    expect(resolveConfig(Config({})).judgment.localLlm.modelPath).toBe(DEFAULT_JUDGE_MODEL_PATH)
  })

  it('keeps an explicit model path and an explicit zero offload', () => {
    const resolved = resolveConfig(Config({
      judgment: {
        ruleEngine: { mode: 'relaxed' },
        localLlm: {
          enabled: false, autoDownload: false, modelPath: 'D:/weights/judge.gguf',
          modelVersion: '', promptVersion: 'v1', gpuLayers: 0, contextSize: 2048,
        },
      },
    }))
    expect(resolved.judgment.localLlm.modelPath).toBe('D:/weights/judge.gguf')
    expect(resolved.judgment.localLlm.gpuLayers).toBe(0)
  })

  it('refuses a config the schema never produced', () => {
    const partial: MemoryConfig = { ...Config({}) }
    delete partial.retention
    expect(() => resolveConfig(partial)).toThrow('plugin config was not resolved')
  })
})
