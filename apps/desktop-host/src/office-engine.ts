/** Resolve packaged Office engine manifests from their complete, unpacked resource directories. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { registerHooks, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Engine package names the short tree mirrors. */
const ENGINE_PACKAGE = /^libreoffice-kit(?:-(?:darwin|win32|linux)-[a-z0-9]+)?$/u

/**
 * Copy one package and its runtime dependency closure into the short tree.
 * @param name - Package name to copy.
 * @param source - Application `node_modules` directory.
 * @param target - Short-tree `node_modules` directory.
 * @returns void
 */
function copyPackage(name: string, source: string, target: string): void {
  if (existsSync(join(target, name))) return
  const from = join(source, name)
  if (!existsSync(from)) return
  cpSync(from, join(target, name), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) copyPackage(dependency, source, target)
}

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Copy the unpacked engine packages and the wrapper's dependency closure to a
 * short temp-directory tree.
 *
 * The native helper resolves its program resources relative to the program
 * directory it is handed, and Windows caps those paths at 260 characters: the
 * deepest resource sits 78 characters below the package root, while the
 * packaged `app.asar.unpacked` tree leaves barely 50, so the helper fails to
 * load a document with an opaque native exception. A copy under the temp
 * directory holds every engine path near 110 characters. Other platforms have
 * no such cap and keep the direct unpacked path.
 *
 * The skill CLI runs as its own Node process whose `require.resolve` bypasses
 * module hooks, so the wrapper's runtime dependency closure travels with it.
 * The tree is keyed by the archive, so an application update copies fresh
 * packages rather than reusing a stale tree.
 * @param archive - Application ASAR path beside its unpacked directory.
 * @param runtimeSegment - Unpacked runtime directory name relative to the archive.
 * @returns The tree root holding `node_modules/@deepseek-ai`, or undefined off Windows.
 */
export function shortEngineTree(archive: string, runtimeSegment: string): string | undefined {
  if (process.platform !== 'win32') return undefined
  const engines = join(`${archive}.unpacked`, runtimeSegment, 'node_modules', '@deepseek-ai')
  if (!existsSync(engines)) return undefined
  const tree = join(tmpdir(), `dsh-office-engine-${createHash('sha1').update(archive).digest('hex').slice(0, 12)}`)
  const modules = join(tree, 'node_modules')
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  for (const entry of readdirSync(engines, { withFileTypes: true })) {
    if (!ENGINE_PACKAGE.test(entry.name)) continue
    copyPackage(`@deepseek-ai/${entry.name}`, dirname(engines), modules)
  }
  return tree
}

/**
 * Keep engine executable and resource paths usable by native child processes outside Electron.
 * Hooks apply only to this thread; worker threads must install their own resolver.
 * @param runtimeDir - Prepared or ASAR-contained dsh runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-ASAR runtime.
 */
export function installOfficeEngineResolution(runtimeDir: string): ModuleHooks | undefined {
  if (runtimeArchivePath(runtimeDir) === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = dirname(root)
  const runtimeSegment = relative(archive, root)
  const shortTree = shortEngineTree(archive, runtimeSegment)
  const base = shortTree === undefined
    ? join(`${archive}.unpacked`, runtimeSegment, 'node_modules', '@deepseek-ai', 'libreoffice-kit-')
    : join(shortTree, 'node_modules', '@deepseek-ai', 'libreoffice-kit-')
  const source = pathToFileURL(join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit-')).href
  const destination = pathToFileURL(base).href
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!/^@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-/u.test(specifier)) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop Office engine resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      const physical = realpathSync(fileURLToPath(destination + canonical.slice(source.length)))
      return { ...resolved, url: pathToFileURL(physical).href }
    },
  })
}
