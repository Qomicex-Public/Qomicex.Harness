import { describe, expect, it } from 'vitest'
import { judge, RULE_FALLBACK_CONFIDENCE } from '../src/algorithms/judgment.ts'
import type { LocalJudge } from '../src/algorithms/judgment.ts'

const input = { current: '这个项目的构建命令是 pnpm run build', context: ['上一个问题用了 webpack'], hints: ['project_fact'] }

describe('judge', () => {
  it('uses the rule fallback when no provider is mounted', async () => {
    const result = await judge(undefined, input)
    expect(result).toEqual({ verdict: 'remember', confidence: RULE_FALLBACK_CONFIDENCE, source: 'rule-engine' })
  })

  it('prefers the local provider verdict when one is wired', async () => {
    const provider: LocalJudge = {
      async judge() {
        return { verdict: 'forget', confidence: 0.9, source: 'local-llm' }
      },
    }
    const result = await judge(provider, input)
    expect(result).toEqual({ verdict: 'forget', confidence: 0.9, source: 'local-llm' })
  })

  it('falls back to the rule path when the provider returns nothing', async () => {
    const provider: LocalJudge = { async judge() { return undefined } }
    const result = await judge(provider, input)
    expect(result.verdict).toBe('remember')
    expect(result.source).toBe('rule-engine')
  })

  it('falls back to the rule path when the provider throws', async () => {
    const provider: LocalJudge = {
      async judge() { throw new Error('model down') },
    }
    const result = await judge(provider, input)
    expect(result.verdict).toBe('remember')
    expect(result.source).toBe('rule-engine')
  })
})
