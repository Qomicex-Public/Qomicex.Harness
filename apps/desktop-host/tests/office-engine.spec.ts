import { mkdirSync, mkdtempSync, existsSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installOfficeEngineResolution, shortEngineTree } from '../src/office-engine.ts'

const roots: string[] = []
const trees: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(runtimeName = 'dsh', beforeInstall?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'desktop-office-resolution-'))
  roots.push(root)
  const runtime = join(root, 'app.asar', runtimeName)
  const manifest = 'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'
  for (const base of [runtime, join(root, 'app.asar.unpacked', runtimeName)]) {
    const path = join(base, manifest)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: '@deepseek-ai/libreoffice-kit-darwin-arm64', path: realpathSync(dirname(path)) }))
  }
  for (const base of [runtime, join(root, 'app.asar.unpacked', runtimeName)]) {
    const path = join(base, 'node_modules/@deepseek-ai/libreoffice-kit/package.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ name: '@deepseek-ai/libreoffice-kit', version: '0.1.2', path: realpathSync(dirname(path)), dependencies: {} }))
  }
  for (const base of [runtime, join(root, 'app.asar.unpacked', runtimeName)]) {
    const path = join(base, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'old cli\n')
  }
  beforeInstall?.(root)
  const require: (specifier: string) => unknown = createRequire(join(runtime, 'package.json'))
  const hook = installOfficeEngineResolution(runtime)!
  hooks.push(hook)
  // The short tree copies the unpacked packages; the manifest content keeps its
  // unpacked origin, so the redirect target is observed through the tree.
  const tree = shortEngineTree(join(root, 'app.asar'), runtimeName)
  if (tree !== undefined) trees.push(tree)
  return { root, runtime, manifest, require, tree }
}

it('resolves engine manifests to physical directories and leaves unrelated modules alone', () => {
  const f = fixture()
  // Node 24.13 require.resolve bypasses hooks; Electron's require.resolve is covered by packaged Office smoke.
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.root, 'app.asar.unpacked', 'dsh', f.manifest))) })
  expect((f.require('node:fs') as typeof import('node:fs')).realpathSync).toBe(realpathSync)
  // The wrapper resolves from the short tree on Windows so its own
  // `require.resolve` finds the platform engine at a short path; the manifest
  // content keeps its unpacked origin either way.
  expect(f.require('@deepseek-ai/libreoffice-kit/package.json'))
    .toMatchObject({ name: '@deepseek-ai/libreoffice-kit',
      path: realpathSync(dirname(join(f.root, 'app.asar.unpacked', 'dsh', 'node_modules/@deepseek-ai/libreoffice-kit/package.json'))) })
  // Windows keeps the engine out of the long packaged path; other platforms resolve it in place.
  if (process.platform === 'win32') expect(f.tree).toBeDefined()
  else expect(f.tree).toBeUndefined()
})

it('rejects an engine missing from the unpacked tree instead of using its archived copy', () => {
  const f = fixture('dsh', (root) => {
    rmSync(join(root, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai'), { recursive: true })
  })
  expect(f.tree).toBeUndefined()
  expect(() => { f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json') }).toThrow()
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-office-prepared-'))
  roots.push(root)
  expect(installOfficeEngineResolution(join(root, 'dsh'))).toBeUndefined()
})

it('preserves a renamed runtime directory when locating the unpacked engine', () => {
  const f = fixture('alternate-runtime')
  expect(f.require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.root, 'app.asar.unpacked', 'alternate-runtime', f.manifest))) })
})

it('rebuilds the short tree when an in-place update ships new engine files', () => {
  const f = fixture()
  if (f.tree === undefined) return
  expect(readFileSync(join(f.tree!, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), 'utf8')).toBe('old cli\n')
  // The updated application replaces the unpacked packages in place; the
  // archive path is unchanged, which is exactly the case the old path-keyed
  // tree reused stale content for.
  const unpacked = join(f.root, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai')
  writeFileSync(join(unpacked, 'libreoffice-kit', 'lib', 'cli.js'), 'new cli\n')
  writeFileSync(join(unpacked, 'libreoffice-kit', 'package.json'), JSON.stringify({ name: '@deepseek-ai/libreoffice-kit', version: '0.2.0', dependencies: {} }))
  const rebuilt = shortEngineTree(join(f.root, 'app.asar'), 'dsh')
  trees.push(rebuilt!)
  expect(rebuilt).not.toBe(f.tree)
  expect(readFileSync(join(rebuilt!, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), 'utf8')).toBe('new cli\n')
})

it('reuses a complete short tree across restarts without recopying', () => {
  const f = fixture()
  if (f.tree === undefined) return
  const before = readFileSync(join(f.tree!, '.complete'), 'utf8')
  expect(shortEngineTree(join(f.root, 'app.asar'), 'dsh')).toBe(f.tree)
  expect(readFileSync(join(f.tree!, '.complete'), 'utf8')).toBe(before)
})

it('rebuilds a short tree left incomplete by an interrupted copy', () => {
  const f = fixture()
  if (f.tree === undefined) return
  rmSync(join(f.tree!, '.complete'))
  const rebuilt = shortEngineTree(join(f.root, 'app.asar'), 'dsh')
  expect(rebuilt).toBe(f.tree)
  expect(existsSync(join(rebuilt!, '.complete'))).toBe(true)
})

it('resolves an engine through a directory alias', () => {
  const f = fixture()
  const alias = join(f.root, 'alias')
  symlinkSync(join(f.root, 'app.asar'), alias, 'junction')
  const require: (specifier: string) => unknown = createRequire(join(alias, 'dsh', 'package.json'))
  expect(require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(join(f.root, 'app.asar.unpacked', 'dsh', f.manifest))) })
})

it('rejects an engine resolved elsewhere inside the archive', () => {
  const f = fixture()
  const other = join(f.root, 'app.asar', 'other', f.manifest)
  mkdirSync(dirname(other), { recursive: true })
  writeFileSync(other, '{}')
  const require = createRequire(join(f.root, 'app.asar', 'other', 'package.json'))
  expect(() => { require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json') })
    .toThrow('outside the runtime package directory')
})

it('leaves external engines and the archived WASM engine at their own locations', () => {
  const f = fixture()
  const external = join(f.root, 'external', f.manifest)
  const wasm = join(f.runtime, 'node_modules/@deepseek-ai/libreoffice-kit-wasm/package.json')
  for (const path of [external, wasm]) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ path: realpathSync(dirname(path)) }))
  }
  const require: (specifier: string) => unknown = createRequire(join(f.root, 'external', 'package.json'))
  expect(require('@deepseek-ai/libreoffice-kit-darwin-arm64/package.json'))
    .toMatchObject({ path: realpathSync(dirname(external)) })
  expect(f.require('@deepseek-ai/libreoffice-kit-wasm/package.json'))
    .toMatchObject({ path: realpathSync(dirname(wasm)) })
})
