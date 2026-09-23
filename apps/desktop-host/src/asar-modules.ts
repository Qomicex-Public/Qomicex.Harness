/**
 * Asar-aware module resolution for the packaged Desktop runtime.
 * @module @deepseek-ai/dsh-desktop-host/asar-modules
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Path segment separating an Electron archive from its unpacked payload. */
const ASAR_SEGMENT = '.asar/'
const UNPACKED_SEGMENT = '.asar.unpacked/'

/**
 * Map one asar-virtual module URL onto the unpacked file electron-builder
 * wrote beside the archive.
 *
 * The packaged runtime resolves every module through the archive, including
 * files electron-builder unpacked so native loading receives real filesystem
 * paths. A library that derives its load path from module resolution — the
 * Cua Driver platform package opens its DLL from the directory of its
 * resolved `package.json` — cannot open an asar-virtual path. Only URLs whose
 * unpacked file exists are rewritten, so packed modules keep the archive.
 *
 * @param url - resolved module URL.
 * @returns the unpacked URL when that file exists; otherwise `undefined`.
 */
export function unpackedModuleUrl(url: string): string | undefined {
  if (!url.startsWith('file:') || url.includes(UNPACKED_SEGMENT)) return undefined
  const index = url.indexOf(ASAR_SEGMENT)
  if (index < 0) return undefined
  const unpacked = `${url.slice(0, index)}${UNPACKED_SEGMENT}${url.slice(index + ASAR_SEGMENT.length)}`
  return existsSync(fileURLToPath(unpacked)) ? unpacked : undefined
}
