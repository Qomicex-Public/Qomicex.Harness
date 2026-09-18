/**
 * End-to-end: the memory Settings page's data path over a real CLI boot.
 *
 * Boots the real CLI in headless mode with the memory plugin enabled and a mock
 * LLM, drives one turn, then mounts the memory Remote controller over the same
 * on-disk store and asserts the graph projection carries what the plugin wrote.
 *
 * This is the check the unit tests cannot make. A unit test mounts the plugin
 * in-process with an in-memory backend, so it proves the projection logic but
 * not that the plugin mounts in a real composition, writes to the path the
 * deployment configures, or survives the CLI's own startup. This spec covers
 * all three.
 *
 * Skipped when the CLI source tree is absent (the package is published
 * standalone), so the suite stays runnable outside a source checkout.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import * as memory from '@deepseek-ai/dsh-memory'
import { MEMORY_SERVICES } from '@deepseek-ai/dsh-memory'
import type { MemoryRepository } from '@deepseek-ai/dsh-memory'
import MemoryController from '../src/index.ts'

const ROOT = resolve(import.meta.dirname, '../../../..')
const CLI_BIN = join(ROOT, 'apps', 'cli', 'src', 'bin.ts')
const STORE_RELATIVE = join('storages', 'bio_memory.json')

const roots: Context[] = []
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Run one child process to completion, capturing output. */
function run(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 180_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

/** Mount the memory plugin and this controller over a deployment's store. */
async function withMemory<T>(home: string, body: (context: {
  repository: MemoryRepository
  controller: InstanceType<typeof MemoryController>
}) => Promise<T>): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  // Register the JSON backend directly rather than through the package's plugin
  // body: the point of this spec is the memory data path, and the hub's own
  // registration path is covered by its package's tests.
  ctx.storage.backend.register('json', new JsonStorageBackend(join(home, 'storages')))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json', routes: {} }))
  await ctx.plugin(memory, {})
  await ctx.plugin(MemoryController)
  roots.push(ctx)
  const repository = ctx.get(MEMORY_SERVICES.repository) as MemoryRepository
  return body({ repository, controller: ctx.memoryController })
}

describe.skipIf(!existsSync(CLI_BIN))('memory Settings page data path over a real CLI boot', () => {
  it('enables the plugin in the web profile, where the Settings page is reachable', async () => {
    // The page lives in the browser roster, which only the web profile mounts.
    // A page whose subject were disabled there would render its "not enabled"
    // state on every deployment, so the enablement is part of the feature.
    const patch = await readFile(join(ROOT, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'), 'utf8')
    const rows = patch.split('\n')
    const index = rows.findIndex(row => row.trim() === '- id: bio-memory')
    expect(index, 'web-app patch declares a bio-memory row').toBeGreaterThanOrEqual(0)
    const block = rows.slice(index, index + 4).join('\n')
    expect(block).toContain('disabled: false')
  })

  it('mounts the plugin, writes the store, and projects it through the Remote graph', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-memory-e2e-'))
    temporary.push(workspace)
    const home = join(workspace, 'home')
    await mkdir(home, { recursive: true })
    // The mock speaks the chat-completions shape; the provider's other protocol
    // would fail request-extension preparation before any turn runs.
    await writeFile(join(home, 'settings.yaml'), 'llm-deepseek:\n  protocol: chat-completions\n', 'utf8')

    const mock = await startMockLlmServer({ sequence: ['success'], repeatLast: true, successText: 'Noted.' })
    try {
      const patchPath = join(workspace, 'memory-on.yml')
      await writeFile(patchPath, [
        '- id: bio-memory',
        '  disabled: false',
        '  config:',
        '    thresholds:',
        '      excitability: 0.0',
        '',
      ].join('\n'), 'utf8')

      const turn = await run([
        '--import', 'tsx/esm',
        CLI_BIN,
        '--profile', 'headless',
        '--patch', patchPath,
        '以后都用 pnpm 安装依赖',
      ], {
        ...process.env,
        DSH_HOME: home,
        DEEPSEEK_BASE_URL: mock.baseURL,
        DEEPSEEK_API_KEY: 'mock-key',
      }, join(ROOT, 'apps', 'cli'))

      // The CLI writes the store during its own startup and turn; a nonzero exit
      // would mean the composition failed before the memory plugin could run.
      expect(turn.code, `stdout:\n${turn.stdout.slice(-2000)}\nstderr:\n${turn.stderr.slice(-2000)}`).toBe(0)

      const storePath = join(home, STORE_RELATIVE)
      expect(existsSync(storePath), `store missing at ${STORE_RELATIVE}`).toBe(true)
      const parsed = JSON.parse(await readFile(storePath, 'utf8')) as { tables?: Record<string, unknown> }
      expect(Object.keys(parsed.tables ?? {}).length).toBeGreaterThan(0)

      const { stored, status, graph } = await withMemory(home, async ({ repository, controller }) => ({
        stored: (await repository.everyMemory()).length,
        status: await controller.status(),
        graph: await controller.graph(),
      }))

      expect(status.mounted).toBe(true)
      expect(Array.isArray(graph.nodes)).toBe(true)
      expect(Array.isArray(graph.edges)).toBe(true)
      expect(Array.isArray(graph.scopes)).toBe(true)
      expect(graph.stats.total).toBe(stored)
      expect(graph.stats.total).toBeGreaterThan(0)
    } finally {
      await mock.close()
    }
  }, 240_000)
})
