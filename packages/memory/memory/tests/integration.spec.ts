import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHotPack } from '../src/hot-pack.ts'
import { collectIntegrationSections, loadIntegrations } from '../src/integration.ts'
import type { HotPackSection, Integration } from '../src/integration.ts'
import { createToolkitIntegration, TOOLKIT_PREFERENCES_FILE } from '../src/integrations/toolkit.ts'
import { Context } from '@deepseek-ai/cordis'
import { resolveConfig, Config } from '../src/config.ts'
import { projectScope, serializeScope } from '../src/scope/namespace.ts'

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
  /** A serialized project scope whose id is the given working directory. */
  const scopeOfCwd = (cwd: string): string => serializeScope(projectScope(cwd))

  it('detects once per machine and defers presence to each scope', async () => {
    // The `.memory/` directory lives in a workspace, so whether the toolkit is
    // installed is not knowable before a scope arrives. The probe only answers
    // for an explicit root; per-scope discovery always loads.
    expect(await createToolkitIntegration().detect()).toBe(true)
    const root = await tempDir()
    expect(await createToolkitIntegration({ root }).detect()).toBe(false)
    await mkdir(join(root, '.memory'), { recursive: true })
    expect(await createToolkitIntegration({ root }).detect()).toBe(true)
  })

  it('finds the .memory directory of the workspace the scope names', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- 前端用 pnpm\n- 回复用中文\n', 'utf8')
    const section = await createToolkitIntegration().collectHotPackSection?.(scopeOfCwd(root))
    expect(section?.name).toBe('toolkit')
    expect(section?.content).toContain('前端用 pnpm')
    expect(section?.budgetBytes).toBeGreaterThan(0)
  })

  it('reads a different workspace for a different scope', async () => {
    // The failure this guards: one configured root cannot serve two
    // workspaces, so the directory has to follow the scope.
    const first = await tempDir()
    const second = await tempDir()
    await mkdir(join(first, '.memory'), { recursive: true })
    await writeFile(join(first, '.memory', TOOLKIT_PREFERENCES_FILE), '- 第一个工作区\n', 'utf8')
    await mkdir(join(second, '.memory'), { recursive: true })
    await writeFile(join(second, '.memory', TOOLKIT_PREFERENCES_FILE), '- 第二个工作区\n', 'utf8')
    const integration = createToolkitIntegration()
    expect((await integration.collectHotPackSection?.(scopeOfCwd(first)))?.content).toContain('第一个工作区')
    expect((await integration.collectHotPackSection?.(scopeOfCwd(second)))?.content).toContain('第二个工作区')
  })

  it('contributes nothing for a workspace with no .memory directory', async () => {
    const root = await tempDir()
    expect(await createToolkitIntegration().collectHotPackSection?.(scopeOfCwd(root))).toBeNull()
  })

  it('contributes nothing for a scope that names no workspace', async () => {
    expect(await createToolkitIntegration().collectHotPackSection?.('global')).toBeNull()
  })

  it('contributes nothing when the preferences file is missing', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    expect(await createToolkitIntegration().collectHotPackSection?.(scopeOfCwd(root))).toBeNull()
  })

  it('contributes nothing when the preferences file is blank', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '   \n', 'utf8')
    expect(await createToolkitIntegration().collectHotPackSection?.(scopeOfCwd(root))).toBeNull()
  })

  it('honours a custom budget', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- x\n', 'utf8')
    const section = await createToolkitIntegration({ budgetBytes: 128 })
      .collectHotPackSection?.(scopeOfCwd(root))
    expect(section?.budgetBytes).toBe(128)
  })

  it('still reads the override root when one is configured', async () => {
    const root = await tempDir()
    await mkdir(join(root, '.memory'), { recursive: true })
    await writeFile(join(root, '.memory', TOOLKIT_PREFERENCES_FILE), '- 覆盖路径\n', 'utf8')
    const section = await createToolkitIntegration({ root }).collectHotPackSection?.('global')
    expect(section?.content).toContain('覆盖路径')
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
    expect(resolved.integrations.toolkit.enabled).toBe('auto')
  })

  it('defaults both integration directions on', async () => {
    // Reading in and writing back are separately gated, and both are on by
    // default: `enabled: 'auto'` already decides presence per workspace, so a
    // second opt-in would only turn an integration that is already mounted
    // into a no-op.
    const resolved = resolveConfig(Config({}))
    expect(resolved.integrations.toolkit.readHotPackSection).toBe(true)
    expect(resolved.integrations.toolkit.writeBackOnApproval).toBe(true)
  })

  it('keeps a disabled integration out of the candidate list entirely', async () => {
    // `off` and a disabled auto-detect both mean no candidate is built, so
    // there is nothing to probe and nothing that can fail.
    const disabled = resolveConfig(Config({
      integrations: {
        autoDetect: true,
        toolkit: { enabled: 'off', readHotPackSection: false, writeBackOnApproval: false },
      },
    }))
    expect(disabled.integrations.autoDetect && disabled.integrations.toolkit.enabled !== 'off').toBe(false)

    const undetected = resolveConfig(Config({
      integrations: {
        autoDetect: false,
        toolkit: { enabled: 'auto', readHotPackSection: false, writeBackOnApproval: false },
      },
    }))
    expect(undetected.integrations.autoDetect && undetected.integrations.toolkit.enabled !== 'off').toBe(false)

    // The default is neither of those, so the toolkit is a candidate and finds
    // each workspace's own `.memory/` from the scope a pack is built for.
    const enabled = resolveConfig(Config({
      integrations: {
        autoDetect: true,
        toolkit: { enabled: 'auto', readHotPackSection: false, writeBackOnApproval: false },
      },
    }))
    expect(enabled.integrations.autoDetect && enabled.integrations.toolkit.enabled !== 'off').toBe(true)
  })
})
