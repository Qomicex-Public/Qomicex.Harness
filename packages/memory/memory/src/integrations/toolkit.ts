/**
 * The toolkit integration: reading the notes the JunSi toolkit already keeps.
 *
 * The toolkit writes its own memory into a `.memory/` directory — decisions,
 * progress, session history — and a person who uses both ends up with two
 * stores saying the same things. This integration closes that gap in the two
 * directions that are safe:
 *
 * - **in**: the toolkit's `preferences.md` becomes a hot-pack section, so a
 *   fresh session starts already knowing what the user prefers.
 * - **out**: a pattern the user approved is appended back to that file, so the
 *   toolkit's own tooling sees the same regularity the memory core extracted.
 *
 * The write direction only ever happens for a pattern a person approved. An
 * unreviewed `candidate` is never written out, because the review gate is what
 * keeps the loop auditable and writing around it would defeat the point.
 *
 * Everything is contained: if the directory is absent, `detect` returns
 * `false` and the core simply has no toolkit section. If the file is
 * unreadable mid-pass, the section is dropped and the pack is still built.
 *
 * @module @deepseek-ai/dsh-memory/src/integrations/toolkit
 */

import { existsSync } from 'node:fs'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HotPackSection, Integration } from '../integration.ts'

/** Default byte budget for the toolkit section. */
export const TOOLKIT_SECTION_BUDGET = 1024

/** The file inside `.memory/` that holds the user's stated preferences. */
export const TOOLKIT_PREFERENCES_FILE = 'preferences.md'

/** Options for the toolkit integration. */
export interface ToolkitIntegrationOptions {
  /**
   * Root holding the `.memory/` directory. A workspace root when the
   * integration is scoped to one project; the user's home when it is global.
   */
  root: string
  /** Byte budget for the contributed section. */
  budgetBytes?: number
}

/**
 * Build the toolkit integration for one root.
 * @param options - The root and budget.
 * @returns The integration.
 */
export function createToolkitIntegration(options: ToolkitIntegrationOptions): Integration {
  const memoryDir = join(options.root, '.memory')
  const budget = options.budgetBytes ?? TOOLKIT_SECTION_BUDGET
  return {
    name: 'toolkit',
    version: '1.0.0',

    detect(): Promise<boolean> {
      // The interface is async because a real probe may need to be; this one
      // is a stat, and wrapping it keeps the seam uniform.
      return Promise.resolve(existsSync(memoryDir))
    },

    async collectHotPackSection(): Promise<HotPackSection | null> {
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
    async writePatternOnApproval(patternId: string, content: string): Promise<void> {
      await mkdir(memoryDir, { recursive: true })
      const file = join(memoryDir, TOOLKIT_PREFERENCES_FILE)
      const line = `- ${content} (来自记忆模式 ${patternId})\n`
      await appendFile(file, line, 'utf8')
    },
  }
}
