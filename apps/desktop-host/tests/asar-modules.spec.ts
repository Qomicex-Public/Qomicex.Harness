/** Unpacked-file mapping for modules resolved inside the packaged archive. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { unpackedModuleUrl } from '../src/asar-modules.ts'

const PLATFORM_PACKAGE = ['dsh', 'node_modules', '@trycua', 'cua-driver-win32-x64-msvc']

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeUnpacked(...segments: readonly string[]): Promise<{ root: string; path: string }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-host-asar-'))
  root = base
  const path = join(base, 'app.asar.unpacked', ...segments)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '{}')
  return { root: base, path }
}

it('maps an asar URL onto its unpacked file', async () => {
  const { root: base, path } = await writeUnpacked(...PLATFORM_PACKAGE, 'package.json')
  const packed = join(base, 'app.asar', ...PLATFORM_PACKAGE, 'package.json')
  expect(unpackedModuleUrl(pathToFileURL(packed).href)).toBe(pathToFileURL(path).href)
})

it('leaves a packed module URL alone when no unpacked file exists', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-host-asar-'))
  await mkdir(join(root, 'app.asar', 'dsh', 'node_modules', '@trycua', 'cua-driver', 'dist'), { recursive: true })
  const packed = join(root, 'app.asar', 'dsh', 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js')
  expect(unpackedModuleUrl(pathToFileURL(packed).href)).toBeUndefined()
})

it('leaves URLs outside an archive alone', () => {
  expect(unpackedModuleUrl(pathToFileURL(join('C:', 'repo', 'node_modules', 'zod', 'index.js')).href)).toBeUndefined()
})

it('does not rewrite an already unpacked URL', async () => {
  const { path } = await writeUnpacked(...PLATFORM_PACKAGE, 'package.json')
  expect(unpackedModuleUrl(pathToFileURL(path).href)).toBeUndefined()
})
