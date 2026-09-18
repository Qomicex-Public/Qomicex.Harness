// Proves the memory plugin is real configurability reached through the real
// Loader, not a hand-wired object graph: a cordis.yml names the package, the
// Loader imports it, and the tools and prompt section follow from the config
// the file carries. Also pins the bundle's default-off posture.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Memory from '@deepseek-ai/dsh-memory'
import { memoryServices } from '@deepseek-ai/dsh-memory'
import { BenchStorageBackend } from '../../memory-benchmark/src/memory-backend.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml naming the memory plugin, over a self-contained storage
 * backend so the test never touches the profile's real store.
 *
 * The base services are mounted directly and the Loader loads only the memory
 * entry. That split is deliberate: the point under test is that the *plugin*
 * is reached through the real Loader, and mounting the peers directly keeps
 * the test's own setup from being what proves it.
 * @param configLines - YAML lines nested under the memory entry's `config:`.
 * @param disabled - Whether the entry carries `disabled: true`.
 * @returns The booted context.
 */
async function boot(configLines: readonly string[], disabled = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-memory'",
    ...disabled ? ['  disabled: true'] : [],
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await mountDomainFacility(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-memory', Memory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

/** Mount the storage domain facility over the in-memory backend. */
async function mountDomainFacility(ctx: Context): Promise<void> {
  const { DomainFacility } = await import('@deepseek-ai/dsh-storage-domain')
  ctx.storage.backend.register('memory', new BenchStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
}

describe('memory plugin real Loader composition through cordis.yml', () => {
  it('registers the three tools and the prompt section when enabled', async () => {
    const ctx = await boot([])
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('memory_recall')
    expect(names).toContain('memory_review')
    expect(names).toContain('memory_forget')
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.sections.map(section => section.text).join('\n'))
      .toContain('persistent memory across sessions')
  }, 30_000)

  it('publishes the services the plugin owns', async () => {
    const ctx = await boot([])
    expect(ctx.get('memoryCore')).toBeDefined()
    expect(ctx.get('memoryRepository')).toBeDefined()
    expect(ctx.get('memoryDaemon')).toBeDefined()
    expect(ctx.get('memoryPolicyPlane')).toBeDefined()
  }, 30_000)

  it('loads with the config the file carries', async () => {
    const ctx = await boot([
      '    retrieval:',
      '      topK: 3',
      '    authorization:',
      '      enabled: true',
      '      policyVersion: custom-1',
    ])
    expect(memoryServices(ctx)?.config.retrieval.topK).toBe(3)
    expect(memoryServices(ctx)?.config.authorization.enabled).toBe(true)
    expect(memoryServices(ctx)?.config.authorization.policyVersion).toBe('custom-1')
  }, 30_000)

  it('registers nothing when the entry is disabled', async () => {
    const ctx = await boot([], true)
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('memory_recall')
    expect(ctx.get('memoryCore')).toBeUndefined()
  }, 30_000)

  it('fails loading on a malformed config value', async () => {
    // Schemastery validates the plugin Config, so a bad type fails at load
    // rather than at first use.
    await expect(boot(['    retrieval:', '      topK: "many"'])).rejects.toThrow(/retrieval\.topK|expected number/)
  }, 30_000)

  it('detaches every contribution when the plugin entry disposes', async () => {
    const ctx = await boot([])
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('memory_recall')
    // Dispose the memory entry's own fiber, not the root: the root owns the
    // peer services this test mounted, and tearing those down would remove the
    // tools registry the assertion reads through.
    const entry = ctx.loader.entries().find(candidate => candidate.options.name === '@deepseek-ai/dsh-memory')
    expect(entry).toBeDefined()
    await entry?.fiber?.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('memory_recall')
    expect(ctx.get('memoryCore')).toBeUndefined()
    expect(ctx.get('memoryRepository')).toBeUndefined()
  }, 30_000)
})
