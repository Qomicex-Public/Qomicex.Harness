/** Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. */
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { excludedNames } from 'app-builder-lib/out/fileMatcher.js'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import type { DesktopRuntimeDescriptor, DesktopRuntimeFile } from '../src/runtime-tree.ts'

// electron-builder's packer strips these basenames from every archive, so the
// prepared inventory can list a marker no packed archive will ever contain —
// vendor tarballs ship `.gitkeep` files. Both sides drop them before comparing.
const PACKER_STRIPPED = new Set(excludedNames.split(',').map(name => name.trim()).filter(name => name.length > 0))
// Both separators: the prepared inventory is built with `path.join` on Windows.
const basename = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
const packerKeeps = (path: string): boolean => !PACKER_STRIPPED.has(basename(path))

/**
 * Compare the complete archived dsh tree with the sealed preparation inventory.
 * @param archivePath - Application ASAR file beside its unpacked directory.
 * @param expected - Verified preparation descriptor, including its complete file inventory.
 * @returns Resolves when bytes, file membership and meaningful executable permissions match.
 */
export async function verifyRuntimeArchive(archivePath: string, expected: DesktopRuntimeDescriptor): Promise<void> {
  const archive = await readAsar(archivePath)
  const descriptor = await archive.readFile(join('dsh', 'desktop-runtime.json'))
  if (!descriptor.equals(Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`))) {
    throw new Error('desktop runtime: archived descriptor differs from preparation')
  }
  const files: DesktopRuntimeFile[] = []
  const unpacked = new Set<string>()
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`desktop runtime: unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archivePath}.unpacked`, name)) : undefined
    if (physical !== undefined && !physical.isFile()) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
    if (node.unpacked === true) unpacked.add(join(`${archivePath}.unpacked`, name))
    if (path === 'desktop-runtime.json') return
    const body = await archive.readFile(name)
    // ASAR stores only owner-execute; group/other-only executable files fail the inventory comparison.
    const executable = process.platform !== 'win32' && (physical !== undefined
      ? (physical.mode & 0o111) !== 0
      : node.executable === true)
    files.push({ path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), executable })
  }
  await visit(archive.getFile('dsh', false), '')
  const entries = await readdir(join(`${archivePath}.unpacked`, 'dsh'), { recursive: true, withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && unpacked.size === 0) return []
      throw error
    })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const path = join(entry.parentPath, entry.name)
    // A marker the packer strips from the archive can still sit inside a
    // wholesale-copied unpacked directory; it is not an inventory violation.
    if (!packerKeeps(path)) continue
    if (!entry.isFile() || !unpacked.has(path)) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // The packer strips marker basenames from the archive and wholesale-copies
  // some unpacked directories over them, so either side can still list a
  // marker; both sides drop them and compare the rest.
  const archived = files.filter(file => packerKeeps(file.path))
  const comparable = expected.files.filter(file => packerKeeps(file.path))
  if (JSON.stringify(archived) !== JSON.stringify(comparable)) throw new Error('desktop runtime: ASAR integrity verification failed')
}
