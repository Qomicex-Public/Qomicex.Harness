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

  it('reads a standing instruction as a rule, not as a scheduled task', () => {
    // A bare 以后 schedules one task; the tier it earns is the difference
    // between a project fact and one every project reads. The modal after 以后
    // is what makes it a rule. These are long enough to clear MIN_STATEMENT_LENGTH,
    // which is the only other thing standing between a task and the store.
    expect(detectUserStatement('以后都用 pnpm')?.strength).toBe(0.95)
    expect(detectUserStatement('以后一律用 pnpm')?.strength).toBe(0.95)
    expect(detectUserStatement('从今以后都别再写注释了')?.strength).toBe(0.95)
    expect(detectUserStatement('从此用 tabs')?.strength).toBe(0.95)
    expect(detectUserStatement('以后给插件商店加上骨架图的加载状态')?.strength).toBeLessThan(0.95)
    expect(detectUserStatement('以后再加一个批量导入整合包的功能进去')?.strength).toBeLessThan(0.95)
    expect(detectUserStatement('以后把下载中心的实例安装流程重新设计一遍')?.strength).toBeLessThan(0.95)
  })

  it('lets a named project outrank a standing cue', () => {
    // "一律" is one of the standing modals, but "这个项目一律用 pnpm" names
    // where the fact lives. Promoting it would tell every other project
    // something false about itself, which is the exact failure the tier table
    // exists to prevent. The tier is what matters, so the assertion is on not
    // reaching the standing strength rather than on which narrower rule wins.
    expect(detectUserStatement('这个项目一律用 pnpm，不要用 npm')?.strength).toBeLessThan(0.95)
    expect(detectUserStatement('本仓库以后都用 pnpm 管理依赖')?.strength).toBeLessThan(0.95)
    expect(detectUserStatement('this project always uses pnpm')?.strength).toBeLessThan(0.95)
    // Without the project reference the same cue is a genuine standing rule.
    expect(detectUserStatement('以后一律用 pnpm，不要用 npm')?.strength).toBe(0.95)
    // A project reference alone is not a rule: it stays the generic candidate
    // the relaxed mode was already producing, because no keyword rule fires.
    expect(detectUserStatement('这个仓库的发布窗口是每周四晚上')?.strength).toBe(0.6)
  })
})
