/** Prepare the target Electron distribution and pinned pnpm CLI. */

import { packagingStep } from './packaging-step.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

/**
 * Extract a `.zip` archive with the platform `tar` executable.
 *
 * `extract-zip@2.0.1` leaves its promise unsettled under Node 24 (the promise
 * never settles, so `await` hangs and the process exits on the unsettled
 * top-level await), which blocks every Desktop package command. libarchive's
 * `tar` reads zip natively on Windows, macOS, and Linux and reports real
 * failures through its exit status.
 * @param archive - Absolute path of the archive to extract.
 * @param destination - Absolute directory that receives the extracted tree.
 */
async function extractZipArchive(archive: string, destination: string): Promise<void> {
  // `tar -C` chdirs into the destination, and the caller removes it first, so
  // the directory must exist again before extraction.
  mkdirSync(destination, { recursive: true })
  const result = spawnSync('tar', ['-xf', archive, '-C', destination], { encoding: 'utf8' })
  if (result.error !== undefined) {
    throw new Error(`desktop runtime: tar is unavailable to extract ${archive}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() === '' ? `exit ${String(result.status)}` : result.stderr.trim()
    throw new Error(`desktop runtime: extracting ${archive} failed: ${detail}`)
  }
}

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = resolveDesktopBuildTarget()
  const platform = target.startsWith('mac-') ? 'darwin' : 'win32'
  const arch = target.endsWith('arm64') ? 'arm64' : 'x64'
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
    () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
  rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => extractZipArchive(archive, BUILD_PATHS.electron))
  const executable = join(BUILD_PATHS.electron, platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')
  const nodeVersion = execFileSync(executable, ['-p', 'process.versions.node'], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const pnpmVersion = preparePnpm()
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: nodeVersion,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
}

await main()
