/**
 * An in-memory storage backend for benchmark runs.
 *
 * Self-contained rather than imported from another package's `tests/`: a
 * published package's `src` may not reach into a sibling's test directory
 * (TypeScript's rootDir forbids it, and the helper would not exist in a
 * packed install). The benchmark is itself a test harness, so owning its own
 * throwaway medium is the honest arrangement — and it keeps a run from
 * touching the profile's real store.
 *
 * @module @deepseek-ai/dsh-memory-benchmark/src/memory-backend
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/** One unit's medium: tables of records plus the global slot. */
interface Medium {
  /** Records per table. */
  tables: Map<string, Map<string, unknown>>
  /** Global value; `null` means never written. */
  global: unknown
}

/** In-memory KV unit. */
class BenchUnit implements KvUnit {
  private closed = false

  /**
   * @param medium - The shared medium.
   * @param descriptor - The unit descriptor.
   * @param onClose - Called once when the unit closes.
   */
  constructor(
    private readonly medium: Medium,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  /** Throw once the unit is closed. */
  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `memory unit '${this.descriptor.name}' is closed`)
    }
  }

  /** Every table's records plus the global. */
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) {
      tables[table] = Object.fromEntries(this.medium.tables.get(table) ?? [])
    }
    return Promise.resolve({ tables, global: this.medium.global })
  }

  /** Insert or overwrite one record. */
  putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    let records = this.medium.tables.get(table)
    if (records === undefined) {
      records = new Map()
      this.medium.tables.set(table, records)
    }
    records.set(key, value)
    return Promise.resolve()
  }

  /** Delete one record. */
  deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    this.medium.tables.get(table)?.delete(key)
    return Promise.resolve()
  }

  /** Replace the global. */
  setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    this.medium.global = value
    return Promise.resolve()
  }

  /** Release the unit. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closed = true
    this.onClose()
    return Promise.resolve()
  }
}

/**
 * A storage backend whose medium lives only for the process, with a shared
 * pool so a reopen can simulate a restart.
 */
export class BenchStorageBackend implements StorageBackend {
  /** The `kv` facet the domain facility opens units through. */
  readonly kv: KvFacet
  private readonly media = new Map<string, Medium>()
  private readonly versions = new Map<string, number>()
  private readonly openUnits = new Set<string>()
  private closed = false

  /** Build the backend. */
  constructor() {
    this.kv = {
      open: (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
        if (this.closed) {
          return Promise.reject(new StorageError('closed', 'benchmark backend is closed'))
        }
        if (this.openUnits.has(descriptor.name)) {
          return Promise.reject(new Error(`memory unit '${descriptor.name}' is already open`))
        }
        const stamped = this.versions.get(descriptor.name)
        if (stamped === undefined) this.versions.set(descriptor.name, descriptor.version)
        else if (stamped !== descriptor.version) {
          return Promise.reject(new StorageError(
            'version-mismatch',
            `memory unit '${descriptor.name}' is stamped v${stamped}, descriptor wants v${descriptor.version}`,
          ))
        }
        let medium = this.media.get(descriptor.name)
        if (medium === undefined) {
          medium = { tables: new Map(), global: null }
          this.media.set(descriptor.name, medium)
        }
        this.openUnits.add(descriptor.name)
        return Promise.resolve(new BenchUnit(medium, descriptor, () => {
          this.openUnits.delete(descriptor.name)
        }))
      },
    }
  }

  /** Close the backend. */
  close(): Promise<void> {
    this.closed = true
    this.openUnits.clear()
    return Promise.resolve()
  }
}
