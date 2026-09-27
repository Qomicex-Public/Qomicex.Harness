/**
 * Preset-bundled skills: the `!!js` expression a preset patch's
 * `skill-filesystem` row carries resolves against the row's own `baseUrl`
 * (the patch file, the value the Include tree rewrites per mount), and the
 * local provider discovers the skills that directory holds. The expression is
 * read and evaluated through the loader's own dialect, so the test fails if
 * the preset wiring drifts from the loader contract.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { expect, it } from 'vitest'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import { apply as skillFilesystemApply } from '@deepseek-ai/dsh-skill-filesystem'

const PATCHES = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bundle', 'web-app', 'presets',
)

/**
 * One preset patch's bundled skills root, resolved the way its composition row does.
 *
 * @param preset - patch file base name (`junsi` reads `junsi.patch.yml`).
 * @param rootPattern - pattern the resolved root matches; the shipped cordis
 * preset resolves its skills from the `agent-preset` package instead of a
 * bundle-relative `presets/skills` directory.
 * @returns the absolute skills directory the preset's own row mounts.
 */
async function bundledSkillsRoot(preset: string, rootPattern = /presets[\\/]skills/): Promise<string> {
  const patchPath = join(PATCHES, `${preset}.patch.yml`)
  const patch = await readFile(patchPath, 'utf8')
  const patches = load(patch, { schema: entryListSchema }) as {
    insert?: { name?: string; config?: { plugins?: { name?: string; config?: Record<string, unknown> }[] } }[]
  }[]
  const entries = patches.flatMap(entry => entry.insert ?? [])
  const presetRow = entries.find(entry => entry.name === '@deepseek-ai/dsh-agent-preset')
  expect(presetRow, `${preset} declares an agent-preset row`).toBeDefined()
  const row = presetRow?.config?.plugins
    ?.find(candidate => candidate.name === '@deepseek-ai/dsh-skill-filesystem')
  expect(row, `${preset} mounts skill-filesystem`).toBeDefined()
  const config = row?.config as { bundledSkillDir?: unknown } | undefined
  expect(typeof config?.bundledSkillDir, `${preset} configures bundledSkillDir`).toBe('object')
  const baseUrl = pathToFileURL(patchPath).href
  const resolved = interpolate({ baseUrl }, config!.bundledSkillDir) as string
  expect(typeof resolved, `${preset} resolves a bundled root from baseUrl`).toBe('string')
  expect(rootPattern.test(resolved)).toBe(true)
  return resolved
}

/**
 * Discover skills through the real filesystem provider mounted on ctx.skills.
 *
 * @param root - the skills directory to scan.
 * @returns discovered skill names.
 */
async function discoveredSkills(root: string): Promise<string[]> {
  const ctx = new Context()
  await ctx.plugin(SkillRuntime)
  skillFilesystemApply(ctx, { customSkillDirs: [root], watch: false })
  const skills = await ctx.skills.list({})
  return skills.map(skill => skill.name)
}

it('resolves and discovers the junsi preset bundled skills', async () => {
  const root = await bundledSkillsRoot('junsi')
  expect(root.replace(/[\\/]+$/, '')).toBe(join(PATCHES, 'skills', 'junsi'))
  expect(existsSync(join(root, 'requirements-driven-dev', 'SKILL.md'))).toBe(true)
  const names = await discoveredSkills(root)
  expect(names).toContain('requirements-driven-dev')
  expect(names).toContain('diagnose-before-fix')
})

it('resolves and discovers the pentest preset bundled skills', async () => {
  const root = await bundledSkillsRoot('pentest')
  expect(root.replace(/[\\/]+$/, '')).toBe(join(PATCHES, 'skills', 'pentest'))
  const names = await discoveredSkills(root)
  expect(names).toContain('penetration-testing')
})

it('mounts the pentest bundled root as trusted-host so a packaged ASAR root reads directly', async () => {
  // The packaged app resolves the preset inside its ASAR archive; the workspace
  // filesystem service cannot stat a root there, and a custom root's failure
  // is swallowed as an absent path. A trusted-host bundled root reads directly,
  // so the regression is the root's kind, not only its resolved location.
  const patch = await readFile(join(PATCHES, 'pentest.patch.yml'), 'utf8')
  const row = (load(patch, { schema: entryListSchema }) as {
    insert?: { config?: { plugins?: { name?: string; config?: Record<string, unknown> }[] } }[]
  }[])
    .flatMap(entry => entry.insert ?? [])
    .find(entry => entry.config?.plugins !== undefined)
    ?.config?.plugins
    ?.find(candidate => candidate.name === '@deepseek-ai/dsh-skill-filesystem')
  expect(Object.keys(row!.config as Record<string, unknown>)).toContain('bundledSkillDir')
})

it('keeps the cordis preset bundled skills resolving (the wiring this mirrors)', async () => {
  const root = await bundledSkillsRoot('cordis', /[\\/]skills/)
  const names = await discoveredSkills(root)
  expect(names.length).toBeGreaterThan(0)
})
