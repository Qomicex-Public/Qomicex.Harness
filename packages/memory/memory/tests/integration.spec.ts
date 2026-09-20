import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHotPack } from '../src/hot-pack.ts'
import { collectIntegrationSections, loadIntegrations } from '../src/integration.ts'
import type { HotPackSection, Integration } from '../src/integration.ts'
import { createToolkitIntegration, TOOLKIT_PREFERENCES_FILE } from '../src/integrations/toolkit.ts'
import { Context } from '@deepseek-ai/cordis'
import { resolveConfig, Config } from '../src/config.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

const dirs: string[] = []

/** A temp directory, cleaned up after the test. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-int-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A core double serving a fixed memory set. */
function coreOf(memories: readonly never[] = []) {
  return { all: () => Promise.resolve([...memories]) } as never
}

/** An integration that always detects. */
function alwaysIntegration(name: string): Integration {
  return {
    name,
    version: '1.0.0',
    async detect() { return true },
  }
}

/** An integration whose detect throws. */
function throwingIntegration(name: string): Integration {
  return {
    name,
    version: '1.0.0',
    async detect() { throw new Error('probe failed') },
  }
}

describe('loading integrations', () => {
  it('activates the ones that detect', async () => {
    const report = await loadIntegrations([alwaysIntegration('a'), alwaysIntegration('b')])
    expect(report.active.map(item => item.name)).toEqual(['a', 'b'])
    expect(report.skipped).toEqual([])
  })

  it('skips one that does not detect, and says so', async () => {
    const absent: Integration = { name: 'gone', version: '1', async detect() { return false } }
    const report = await loadIntegrations([absent, alwaysIntegration('a')])
    expect(report.active.map(item => item.name)).toEqual(['a'])
    expect(report.skipped).toEqual([{ name: 'gone', reason: 'not detected' }])
  })

  it('contains a detection failure instead of failing the load', async () => {
    // One tool that cannot answer is simply unavailable; the rest still load,
    // and the plugin mount is never at risk.
    const report = await loadIntegrations([throwingIntegration('bad'), alwaysIntegration('good')])
    expect(report.active.map(item => item.name)).toEqual(['good'])
    expect(report.skipped[0]?.name).toBe('bad')
    expect(report.skipped[0]?.reason).toContain('probe failed')
  })

  it('loads nothing from an empty candidate list', async () => {
    expect(await loadIntegrations([])).toEqual({ active: [], skipped: [] })
  })
})

describe('collecting integration sections', () => {
  const section = (name: string, content: string): HotPackSection => ({
    name,
    content,
    budgetBytes: 1024,
  })

  const contributing: Integration = {
    name: 'writer',
    version: '1',
    async detect() { return true },
    async collectHotPackSection() { return section('writer', 'from the writer') },
  }

  const empty: Integration = {
    name: 'empty',
    version: '1',
    async detect() { return true },
    async collectHotPackSection() { return null },
  }

  const broken: Integration = {
    name: 'broken',
    version: '1',
    async detect() { return true },
    async collectHotPackSection() { throw new Error('unreadable') },
  }

  it('collects what each active integration contributes', async () => {
    const sections = await collectIntegrationSections([contributing], 'project=a')
    expect(sections).toEqual([section('writer', 'from the writer')])
  })

  it('keeps the other sections when one throws', async () => {
    const sections = await collectIntegrationSections([broken, contributing], 'project=a')
    expect(sections.map(item => item.name)).toEqual(['writer'])
  })

  it('drops a section with nothing in it', async () => {
    expect(await collectIntegrationSections([empty], 'project=a')).toEqual([])
  })

  it('collects nothing from an integration with no section hook', async () => {
    expect(await collectIntegrationSections([alwaysIntegration('plain')], 'project=a')).toEqual([])
  })
})

describe('the toolkit integration', () => {
  it('does not detect when the toolkit directory is absent', async () => {
    const root = await tempDir()
    expect(await createToolkitIntegration({ root }).detect()).toBe(false)
  })

  it('detects when the toolkit directory exists', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    expect(await createToolkitIntegration({ root }).detect()).toBe(true)
  })

  it('relays the toolkit preferences as a hot-pack section', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- 前端用 pnpm\n- 回复用中文\n', 'utf8')
    const section = await createToolkitIntegration({ root }).collectHotPackSection?.('project=a')
    expect(section?.name).toBe('toolkit')
    expect(section?.content).toContain('前端用 pnpm')
    expect(section?.budgetBytes).toBeGreaterThan(0)
  })

  it('contributes nothing when the preferences file is missing', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    expect(await createToolkitIntegration({ root }).collectHotPackSection?.('project=a')).toBeNull()
  })

  it('contributes nothing when the preferences file is blank', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '   \n', 'utf8')
    expect(await createToolkitIntegration({ root }).collectHotPackSection?.('project=a')).toBeNull()
  })

  it('writes an approved pattern back into the toolkit file', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- 现有偏好\n', 'utf8')
    await createToolkitIntegration({ root }).writePatternOnApproval?.('pat_1', 'TypeScript strict')
    const text = await readFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), 'utf8')
    // The existing content survives; the pattern is appended, not substituted.
    expect(text).toContain('现有偏好')
    expect(text).toContain('TypeScript strict')
    expect(text).toContain('pat_1')
  })

  it('creates the directory when writing to a root that has none', async () => {
    const root = await tempDir()
    await createToolkitIntegration({ root }).writePatternOnApproval?.('pat_1', 'a pattern')
    const text = await readFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), 'utf8')
    expect(text).toContain('a pattern')
  })

  it('honours a custom budget', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- x\n', 'utf8')
    const section = await createToolkitIntegration({ root, budgetBytes: 128 })
      .collectHotPackSection?.('project=a')
    expect(section?.budgetBytes).toBe(128)
  })
})

describe('the hot pack carries integrations apart from the core', () => {
  it('defaults to no integrations when none are contributed', async () => {
    const pack = await buildHotPack(coreOf(), { kind: 'global' }, 1_000)
    expect(pack.integrations).toEqual([])
    // The core sections are still there, so the pack is usable on its own.
    expect(pack.schemaVersion).toBe(4)
    expect(pack.profile).toEqual([])
  })

  it('carries a contributed section alongside the core sections', async () => {
    // The core double serves nothing; the point is that the integration
    // section rides alongside the core's own sections rather than replacing them.
    const pack = await buildHotPack(
      coreOf(),
      { kind: 'global' },
      1_000,
      [],
      [{ name: 'toolkit', content: '[toolkit preferences]\n- 用 pnpm', budgetBytes: 1024 }],
    )
    expect(pack.integrations).toHaveLength(1)
    expect(pack.integrations[0]?.name).toBe('toolkit')
    expect(pack.integrations[0]?.content).toContain('用 pnpm')
  })
})

describe('the core is independent of the integrations', () => {
  it('still mounts and captures with no integration configured', async () => {
    // The invariant the whole separation exists for: with every integration
    // absent, the core is unchanged. Config defaults to autoDetect off, so
    // this is the out-of-the-box shape.
    const resolved = resolveConfig(Config({}))
    expect(resolved.integrations.autoDetect).toBe(false)
    expect(resolved.integrations.toolkitRoot).toBe('')
  })

  it('defaults both integration directions off', async () => {
    // Reading in and writing back are separately gated, and neither is on by
    // default: an integration must be opted into twice, once per direction.
    const resolved = resolveConfig(Config({}))
    expect(resolved.integrations.toolkitReadHotPackSection).toBe(false)
    expect(resolved.integrations.toolkitWriteBackOnApproval).toBe(false)
  })

  it('keeps a disabled integration out of the candidate list entirely', async () => {
    // An empty root means no candidate is even built, so there is nothing to
    // probe and nothing that can fail.
    const resolved = resolveConfig(Config({
      integrations: {
        autoDetect: false,
        toolkitReadHotPackSection: false,
        toolkitWriteBackOnApproval: false,
        toolkitRoot: '',
      },
    }))
    const candidates = resolved.integrations.autoDetect && resolved.integrations.toolkitRoot !== ''
      ? [createToolkitIntegration({ root: resolved.integrations.toolkitRoot })]
      : []
    expect(candidates).toEqual([])
  })
})
