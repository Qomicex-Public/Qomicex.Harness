/** Desktop Office skills and bundled authoring dependencies. */

import { realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeArchivePath, shortEngineTree } from './office-engine.ts'
import type { Context } from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'

/** Loader identity for the application-owned Office composition. */
export const name = 'desktop-office'
/** Application-selected bundled payload and installation directories. */
export interface Config {
  /** Bundled payload directory. Missing sibling `office-skills` resources fail Host startup. */
  readonly source: string
  /** Harness-home directory where workspace dependencies are installed. */
  readonly root: string
  /** Prepared or ASAR-contained application dependency directory. */
  readonly runtimeDir: string
}

/**
 * Enable offline Office authoring and structural checks in the Desktop profile.
 * @param ctx - Profile scope; child plugins declare their own service requirements.
 * @param config - Bundled payload source and Harness-home installation root.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(workspaceDependencies, config)
  const archive = runtimeArchivePath(config.runtimeDir) === undefined ? undefined : dirname(realpathSync(config.runtimeDir))
  const manifest = fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  // The skill CLI runs as its own Node process without the Host's resolver
  // hooks, so it reads the engine from the same short tree the hook installs;
  // without one it takes the direct unpacked path.
  const shortTree = archive === undefined ? undefined : shortEngineTree(archive, relative(archive, realpathSync(config.runtimeDir)))
  const packageRoot = archive === undefined
    ? dirname(manifest)
    : shortTree === undefined
      ? dirname(join(`${archive}.unpacked`, relative(archive, manifest)))
      : join(shortTree, 'node_modules', '@deepseek-ai', 'libreoffice-kit')
  await ctx.plugin(officeSkills, {
    assetRoot: join(dirname(config.source), 'office-skills'),
    node: join(config.source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    cli: join(packageRoot, 'lib', 'cli.js'),
  })
}
