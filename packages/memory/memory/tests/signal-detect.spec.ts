import { describe, expect, it } from 'vitest'
import { detectUserStatement, extractFromToolResult } from '../src/event/signal-detect.ts'

describe('extractFromToolResult', () => {
  it('extracts a package manager from a manifest read', () => {
    const call = { name: 'read', arguments: { path: 'package.json' } }
    const result = { content: [{ type: 'text', text: JSON.stringify({ name: 'demo', packageManager: 'pnpm@9.0.0' }) }] }
    const signals = extractFromToolResult(call, result)
    expect(signals).toHaveLength(1)
    expect(signals[0]?.extracted).toEqual({ subject: 'project', predicate: 'uses_package_manager', object: 'pnpm@9.0.0' })
  })

  it('does not promote a search hit count to a fact', () => {
    // A glob or grep reports how many entries matched. That is procedural
    // noise, not a property of the working directory, so it must not become a
    // semantic fact. (Regression for the search_result_count spam.)
    const cases = [
      { name: 'glob', result: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      { name: 'grep', result: { files: ['a.ts', 'b.ts'] } },
      { name: 'grep', result: { matches: [] } },
      { name: 'glob', result: { paths: [] } },
      { name: 'grep', result: { content: 'one\n\ntwo\n' } },
    ]
    for (const { name, result } of cases) {
      expect(extractFromToolResult({ name, arguments: {} }, result), `${name} => ${JSON.stringify(result)}`).toHaveLength(0)
    }
  })

  it('leaves unrelated tool results as observations only', () => {
    const signals = extractFromToolResult({ name: 'bash', arguments: {} }, 'ls output')
    expect(signals).toHaveLength(0)
  })
})

describe('detectUserStatement', () => {
  it('stages an unconfirmed statement in relaxed mode', () => {
    // No keyword rule fires here: what survives is the noise blacklist, and
    // relaxed mode is what turns "not procedural noise" into a candidate.
    expect(detectUserStatement('这个仓库的发布窗口是每周四晚上')?.type).toBe('user_statement')
  })

  it('drops an unconfirmed statement in strict mode', () => {
    expect(detectUserStatement('这个仓库的发布窗口是每周四晚上', 'strict')).toBeNull()
  })

  it('still stages a keyword-confirmed statement in strict mode', () => {
    expect(detectUserStatement('以后都用 pnpm', 'strict')?.type).toBe('user_statement')
  })

  it('drops procedural noise in both modes', () => {
    expect(detectUserStatement('ls', 'strict')).toBeNull()
    expect(detectUserStatement('ls')).toBeNull()
  })
})
