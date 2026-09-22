/**
 * The toolkit integration: reading the notes the JunSi toolkit already keeps.
 *
 * The toolkit writes its own memory into a `.memory/` directory — decisions,
 * progress, session history — and a person who uses both ends up with two
 * stores saying the same things. This integration closes that gap in the one
 * direction that is safe today:
 *
 * - **in**: the toolkit's `preferences.md` becomes a hot-pack section, so a
 *   fresh session starts already knowing what the user prefers.
 *
 * (The write direction — appending an approved pattern back into the toolkit's
 * own file — is declared by the {@link Integration} seam but has no caller yet,
 * so nothing writes out. It stays declared because the review gate it needs is
 * the pattern layer's, not this file's.)
 *
 * The `.memory/` directory is found **per scope**, not from a configured root.
 * It lives at the root of whatever workspace the session is running in, so one
 * dsh instance serving several workspaces has several `.memory/` directories
 * and no single path could name them all. The scope carries the session's
 * canonical cwd as its project id, which is the workspace root, so the
 * directory is `<cwd>/.memory`. An explicit `root` override exists for a
 * deployment that keeps the notes somewhere else entirely.
 *
 * Everything is contained: a scope with no `.memory/` contributes nothing, an
 * unreadable file drops the section, and the pack is still built either way.
 *
 * @module @deepseek-ai/dsh-memory/src/integrations/toolkit
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parentOf, parseScope } from '../scope/namespace.ts'
import type { HotPackSection, Integration } from '../integration.ts'
import type { ScopeNode } from '../types.ts'

/** Default byte budget for the toolkit section. */
export const TOOLKIT_SECTION_BUDGET = 1024

/** The file inside `.memory/` that holds the user's stated preferences. */
export const TOOLKIT_PREFERENCES_FILE = 'preferences.md'

/** Options for the toolkit integration. */
export interface ToolkitIntegrationOptions {
  /**
   * Root holding the `.memory/` directory, for a deployment that keeps the
   * notes outside the workspace. **Empty (the default) discovers the directory
   * per scope** from the session's working directory, which is what a workspace
   * with its own `.memory/` needs.
   */
  root?: string
  /** Byte budget for the contributed section. */
  budgetBytes?: number
}

/**
 * The nearest project scope at or above a node, or `undefined`.
 *
 * A session scope's parent is its project, and a project's id is the session's
 * canonical cwd — that is the pair this walks to find. `global` and `user`
 * scopes have no project under them, and a memory belonging to them has no
 * workspace to look in.
 * @param node - The scope to start from.
 * @returns The project node, or `undefined` when the chain has none.
 */
function projectOf(node: ScopeNode | undefined): Extract<ScopeNode, { kind: 'project' }> | undefined {
  let current = node
  while (current !== undefined) {
    if (current.kind === 'project') return current
    current = parentOf(current)
  }
  return undefined
}

/**
 * The `.memory/` directory one serialized scope reads its notes from.
 * @param scope - The serialized scope a pack is being built for.
 * @param override - A configured root, which wins over discovery.
 * @returns The directory, or `undefined` when this scope names no workspace.
 */
function memoryDirFor(scope: string, override: string): string | undefined {
  if (override !== '') return join(override, '.memory')
  const project = projectOf(parseScope(scope))
  return project === undefined ? undefined : join(project.projectId, '.memory')
}

/**
 * Build the toolkit integration.
 *
 * `detect` answers "is the toolkit installed", and with per-scope discovery
 * that question cannot be answered before a scope arrives — presence is a
 * property of each workspace, not of the machine. So it reports `true` unless
 * an explicit root was configured and has no `.memory/` under it; the per-scope
 * check happens in {@link Integration.collectHotPackSection}, which returns
 * `null` for a workspace that has none. That is why `enabled: auto` and
 * `enabled: on` behave the same here.
 * @param options - The optional root override and budget.
 * @returns The integration.
 */
export function createToolkitIntegration(options: ToolkitIntegrationOptions = {}): Integration {
  const override = options.root ?? ''
  const budget = options.budgetBytes ?? TOOLKIT_SECTION_BUDGET
  return {
    name: 'toolkit',
    version: '1.0.0',

    detect(): Promise<boolean> {
      if (override === '') return Promise.resolve(true)
      return Promise.resolve(existsSync(join(override, '.memory')))
    },

    async collectHotPackSection(scope: string): Promise<HotPackSection | null> {
      const memoryDir = memoryDirFor(scope, override)
      if (memoryDir === undefined) return null
      const file = join(memoryDir, TOOLKIT_PREFERENCES_FILE)
      if (!existsSync(file)) return null
      const text = await readFile(file, 'utf8')
      const trimmed = text.trim()
      if (trimmed === '') return null
      return {
        name: 'toolkit',
        content: `[toolkit preferences]\n${trimmed}`,
        budgetBytes: budget,
      }
    },
  }
}
