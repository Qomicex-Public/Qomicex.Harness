import { describe, expect, it } from 'vitest'
import { CausalLineage, MIN_OVERLAP_CHARS, toJsonText, toJsonValue } from '../src/event/lineage.ts'
import { detectUserStatement, extractFromToolResult, extractPackageManager } from '../src/event/signal-detect.ts'
import { areIndependent, countIndependentEvidence, makeEvidence } from '../src/evidence/independence.ts'

describe('causal lineage', () => {
  it('opens a new chain per user message', () => {
    const lineage = new CausalLineage().for('s1')
    expect(lineage.openTurn(1)).toBe('user:1')
    expect(lineage.openTurn(5)).toBe('user:5')
  })

  it('gives the assistant message the turn chain, so restatement is not new evidence', () => {
    const lineage = new CausalLineage().for('s1')
    const root = lineage.openTurn(1)
    expect(lineage.assistantRoot(2)).toBe(root)
    expect(lineage.assistantRoot(3)).toBe(root)
  })

  it('falls back to a per-sequence root when no turn is open', () => {
    const lineage = new CausalLineage().for('s1')
    expect(lineage.assistantRoot(7)).toBe('assistant:7')
  })

  it('opens a fresh chain for an unrelated tool call', () => {
    const lineage = new CausalLineage().for('s1')
    lineage.openTurn(1)
    expect(lineage.toolRoot('call-1', undefined, '{"path":"package.json"}')).toBe('tool:call-1')
  })

  it('inherits the enclosing chain for a nested dispatch', () => {
    const lineage = new CausalLineage().for('s1')
    expect(lineage.toolRoot('call-2', 'tool:call-1', '{}')).toBe('tool:call-1')
  })

  it('S012: a second tool consuming the first tool result stays on one chain', () => {
    const lineage = new CausalLineage().for('s1')
    const firstRoot = lineage.toolRoot('call-a', undefined, '{"path":"package.json"}')
    const payload = JSON.stringify({ content: JSON.stringify({ packageManager: 'npm', name: 'demo-project' }) })
    lineage.recordResult('call-a', firstRoot, payload)

    const secondRoot = lineage.toolRoot('call-b', undefined, payload)
    expect(secondRoot).toBe(firstRoot)

    const evidenceA = makeEvidence({
      id: 'e-a', sourceType: 'tool_verified', sourceIdentity: 'read', sessionIdentity: 's1',
      observationMethod: 'tool', causalOrigin: firstRoot, observedAt: 1, rawObservationId: 'o-a',
    })
    const evidenceB = makeEvidence({
      id: 'e-b', sourceType: 'tool_verified', sourceIdentity: 'parse_json', sessionIdentity: 's1',
      observationMethod: 'tool', causalOrigin: secondRoot, observedAt: 2, rawObservationId: 'o-b',
    })
    expect(countIndependentEvidence([evidenceA, evidenceB])).toBe(1)
    expect(areIndependent(evidenceA, evidenceB)).toBe(false)
  })

  it('does not chain on a short value, so re-verification after deletion is a new chain', () => {
    const lineage = new CausalLineage().for('s1')
    const firstRoot = lineage.toolRoot('call-a', undefined, '{}')
    lineage.recordResult('call-a', firstRoot, JSON.stringify('npm'))
    expect(MIN_OVERLAP_CHARS).toBeGreaterThan(3)
    const secondRoot = lineage.toolRoot('call-b', undefined, '"npm"')
    expect(secondRoot).toBe('tool:call-b')
    expect(secondRoot).not.toBe(firstRoot)
  })

  it('reports the chain a settled call belongs to', () => {
    const lineage = new CausalLineage().for('s1')
    const root = lineage.toolRoot('call-a', undefined, '{}')
    lineage.recordResult('call-a', root, 'payload')
    expect(lineage.resultRoot('call-a')).toBe(root)
    expect(lineage.resultRoot('unknown')).toBe('tool:unknown')
  })

  it('bounds the retained result window', () => {
    const lineage = new CausalLineage().for('s1')
    const oldest = `oldest-${'x'.repeat(MIN_OVERLAP_CHARS)}`
    for (let index = 0; index < 200; index += 1) {
      lineage.recordResult(`call-${index}`, `tool:${index}`, `payload-${index}-${'y'.repeat(MIN_OVERLAP_CHARS)}`)
    }
    // The oldest entry fell out of the window, so an argument quoting it no
    // longer chains — while a recent one still does.
    expect(lineage.toolRoot('later', undefined, `quote ${oldest} quote`)).toBe('tool:later')
    expect(lineage.toolRoot('later', undefined, `quote payload-199-${'y'.repeat(MIN_OVERLAP_CHARS)} quote`)).toBe('tool:199')
  })

  it('tracks and releases sessions independently', () => {
    const lineage = new CausalLineage()
    lineage.for('s1').openTurn(1)
    lineage.for('s2').openTurn(1)
    expect(lineage.size).toBe(2)
    lineage.release('s1')
    expect(lineage.size).toBe(1)
    expect(lineage.for('s1').assistantRoot(9)).toBe('assistant:9')
    lineage.clear()
    expect(lineage.size).toBe(0)
  })

  it('S011: user preference plus three agent restatements is one independent witness', () => {
    const lineage = new CausalLineage().for('s1')
    const root = lineage.openTurn(1)
    const observations = [root, lineage.assistantRoot(2), lineage.assistantRoot(3), lineage.assistantRoot(4)]
    const evidence = observations.map((origin, index) => makeEvidence({
      id: `e${index}`,
      sourceType: index === 0 ? 'explicit_user' : 'agent_inference',
      sourceIdentity: index === 0 ? 'user' : 'assistant',
      sessionIdentity: 's1',
      observationMethod: index === 0 ? 'message' : 'assistant',
      causalOrigin: origin,
      observedAt: index,
      rawObservationId: `o${index}`,
    }))
    expect(countIndependentEvidence(evidence)).toBe(1)
    expect(evidence.map(item => item.identity.causalOrigin)).toEqual(['user:1', 'user:1', 'user:1', 'user:1'])
  })
})

describe('signal detection', () => {
  it('detects preferences', () => {
    expect(detectUserStatement('我更喜欢 pnpm')?.type).toBe('user_preference')
    expect(detectUserStatement('I prefer tabs')?.type).toBe('user_preference')
  })

  it('detects standing instructions', () => {
    expect(detectUserStatement('以后都用 pnpm')?.type).toBe('user_statement')
    expect(detectUserStatement('from now on, use tabs')?.type).toBe('user_statement')
    expect(detectUserStatement('以后都用 pnpm')?.strength).toBe(0.95)
  })

  it('detects corrections ahead of generic statements', () => {
    expect(detectUserStatement('不对，我们用 pnpm')?.type).toBe('user_correction')
    expect(detectUserStatement('Actually, the project uses pnpm')?.type).toBe('user_correction')
  })

  it('detects project facts with lower strength', () => {
    expect(detectUserStatement('我们项目使用 pnpm')?.strength).toBe(0.75)
  })

  it('returns null for ordinary chatter', () => {
    expect(detectUserStatement('帮我看看这个函数')).toBeNull()
    expect(detectUserStatement('')).toBeNull()
    expect(detectUserStatement('   ')).toBeNull()
  })

  it('stages a declarative statement as a low-strength candidate', () => {
    const signal = detectUserStatement('这个项目的构建命令是 pnpm run build')
    expect(signal?.type).toBe('user_statement')
    expect(signal?.strength).toBe(0.6)
    expect(signal?.epistemic).toBe('user_stated')
    expect(signal?.sourceType).toBe('explicit_user')
  })

  it('filters acknowledgements, retries, and greetings as noise', () => {
    expect(detectUserStatement('好的，明白了')).toBeNull()
    expect(detectUserStatement('重新来一次')).toBeNull()
    expect(detectUserStatement('你好')).toBeNull()
    expect(detectUserStatement('ok')).toBeNull()
  })

  it('attaches the extracted package-manager triple to a user signal', () => {
    // The signal type alone is not enough: a fact with no triple can never
    // consolidate, so the extraction is what makes a stated preference
    // reach semantic memory.
    expect(detectUserStatement('我更喜欢 pnpm')?.extracted).toEqual({
      subject: 'project', predicate: 'uses_package_manager', object: 'pnpm',
    })
    expect(detectUserStatement('以后都用 yarn')?.extracted?.object).toBe('yarn')
    expect(detectUserStatement('Actually, the project uses bun')?.extracted?.object).toBe('bun')
  })

  it('extracts only the closed set of known package managers', () => {
    for (const manager of ['pnpm', 'npm', 'yarn', 'bun']) {
      expect(extractPackageManager(`we use ${manager}`)?.object).toBe(manager)
    }
    // A word containing a manager name as a substring must not match.
    expect(extractPackageManager('the bundle is large')).toBeUndefined()
    expect(extractPackageManager('a random sentence')).toBeUndefined()
  })

  it('leaves a signal without a triple when no manager is named', () => {
    const signal = detectUserStatement('我更喜欢用 tab 缩进')
    expect(signal?.type).toBe('user_preference')
    expect(signal?.extracted).toBeUndefined()
  })

  it('extracts a declared package manager from a manifest read', () => {
    const signals = extractFromToolResult(
      { name: 'read', arguments: { path: 'package.json' } },
      { content: JSON.stringify({ packageManager: 'pnpm@9.0.0', name: 'demo' }) },
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]?.extracted).toEqual({
      subject: 'project',
      predicate: 'uses_package_manager',
      object: 'pnpm@9.0.0',
    })
    expect(signals[0]?.sourceType).toBe('tool_verified')
  })

  it('accepts a raw manifest string too', () => {
    const signals = extractFromToolResult(
      { name: 'read', arguments: {} },
      JSON.stringify({ packageManager: 'npm' }),
    )
    expect(signals[0]?.extracted?.object).toBe('npm')
  })

  it('ignores a read that is not a manifest', () => {
    expect(extractFromToolResult({ name: 'read', arguments: {} }, 'plain text')).toEqual([])
    expect(extractFromToolResult({ name: 'read', arguments: {} }, { content: 'not json' })).toEqual([])
    expect(extractFromToolResult({ name: 'read', arguments: {} }, { content: JSON.stringify(['a']) })).toEqual([])
    expect(extractFromToolResult({ name: 'read', arguments: {} }, { content: JSON.stringify({ name: 'x' }) })).toEqual([])
  })

  it('does not count search results as facts', () => {
    // A search hit count is procedural noise, not a property worth
    // remembering; it used to be promoted as search_result_count, which
    // spammed the store with one flimsy fact per search.
    expect(extractFromToolResult({ name: 'glob', arguments: {} }, ['a', 'b'])).toEqual([])
    expect(extractFromToolResult({ name: 'grep', arguments: {} }, { files: ['a'] })).toEqual([])
    expect(extractFromToolResult({ name: 'grep', arguments: {} }, { matches: [] })).toEqual([])
    expect(extractFromToolResult({ name: 'grep', arguments: {} }, { results: ['a', 'b', 'c'] })).toEqual([])
    expect(extractFromToolResult({ name: 'glob', arguments: {} }, { paths: ['a'] })).toEqual([])
    expect(extractFromToolResult({ name: 'grep', arguments: {} }, { content: 'a\nb\n' })).toEqual([])
    expect(extractFromToolResult({ name: 'grep', arguments: {} }, { other: 1 })).toEqual([])
  })

  it('extracts text from every read result shape', () => {
    expect(extractFromToolResult({ name: 'read', arguments: {} }, '{"packageManager":"x"}')[0]?.extracted?.object).toBe('x')
    expect(extractFromToolResult(
      { name: 'read', arguments: {} },
      { content: [{ type: 'text', text: '{"packageManager":"y"}' }] },
    )[0]?.extracted?.object).toBe('y')
    expect(extractFromToolResult({ name: 'read', arguments: {} }, { content: [{ type: 'image' }] })).toEqual([])
    expect(extractFromToolResult({ name: 'read', arguments: {} }, null)).toEqual([])
  })

  it('ignores unrelated tools', () => {
    expect(extractFromToolResult({ name: 'bash', arguments: {} }, 'anything')).toEqual([])
  })
})

describe('json normalization', () => {
  it('passes JSON values through', () => {
    expect(toJsonValue({ a: [1, 'b', null] })).toEqual({ a: [1, 'b', null] })
    expect(toJsonValue(undefined)).toBeNull()
  })

  it('degrades unserializable values to null instead of throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(toJsonValue(cyclic)).toBeNull()
    expect(toJsonValue(1n)).toBeNull()
    expect(toJsonText(undefined)).toBe('')
    expect(toJsonText(cyclic)).toBe('')
    expect(toJsonText({ a: 1 })).toBe('{"a":1}')
    expect(toJsonText('x')).toBe('"x"')
  })
})
