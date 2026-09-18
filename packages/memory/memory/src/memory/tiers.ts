/**
 * Memory tiers: episodic (fast, sparse) and semantic (slow, consolidated).
 *
 * The two tiers hold the same record shape and differ only in what put a row
 * there and what may take it out. Episodic rows are what the gates accepted
 * from staging; semantic rows are what consolidation distilled from episodic
 * rows, or promoted verbatim when a fact has been independently confirmed
 * enough times to stop being an episode.
 *
 * Keeping them as separate tables rather than one table with a `tier` column
 * is what lets consolidation scan one tier without touching the other, and
 * what keeps the retrieval hard filter a table choice instead of a predicate.
 *
 * @module @deepseek-ai/dsh-memory/src/memory/tiers
 */

import type { MemoryRepository } from '../repository.ts'
import type { MemoryTableName } from '../domain.ts'
import type { Memory } from '../types.ts'

/** One tier's view over the repository. */
export class MemoryTier {
  /**
   * @param repository - The shared repository.
   * @param table - The table this tier owns.
   */
  constructor(
    private readonly repository: MemoryRepository,
    private readonly table: MemoryTableName,
  ) {}

  /** The table name this tier reads and writes. */
  get name(): MemoryTableName {
    return this.table
  }

  /**
   * Persist one memory.
   * @param memory - The memory.
   * @returns resolution after durability.
   */
  async put(memory: Memory): Promise<void> {
    await this.repository.putMemory(this.table, memory)
  }

  /**
   * Read one memory.
   * @param id - Memory id.
   * @returns The memory, or `undefined`.
   */
  async get(id: string): Promise<Memory | undefined> {
    return this.repository.getMemory(this.table, id)
  }

  /**
   * Every memory in this tier.
   * @returns The stored memories.
   */
  async all(): Promise<Memory[]> {
    return this.repository.allMemories(this.table)
  }

  /**
   * Apply a transform to one memory.
   * @param id - Memory id.
   * @param transform - Synchronous pure transform.
   * @returns The stored next record.
   */
  async update(id: string, transform: (current: Memory) => Memory): Promise<Memory> {
    return this.repository.updateMemory(this.table, id, transform)
  }

  /**
   * Memories whose lifecycle state is one of the given states.
   * @param states - Accepted lifecycle states.
   * @returns The matching memories.
   */
  async withStates(states: readonly Memory['lifecycle']['state'][]): Promise<Memory[]> {
    const accepted = new Set<string>(states)
    return (await this.all()).filter(memory => accepted.has(memory.lifecycle.state))
  }

  /**
   * Memories in one scope, across the reader's readable scopes.
   * @param scopes - Serialized scopes the reader may see.
   * @returns The matching memories.
   */
  async inScopes(scopes: readonly string[]): Promise<Memory[]> {
    const accepted = new Set(scopes)
    return (await this.all()).filter(memory => accepted.has(memory.scope))
  }

  /**
   * Move one memory into another tier.
   * @param to - Destination tier.
   * @param id - Memory id.
   * @returns `true` when the memory existed here.
   */
  async moveTo(to: MemoryTier, id: string): Promise<boolean> {
    return this.repository.moveMemory(this.table, to.table, id)
  }
}

/** The two tiers together, with the cross-tier reads the core needs. */
export class MemoryTiers {
  /** Fast, sparse tier. */
  readonly episodic: MemoryTier
  /** Slow, consolidated tier. */
  readonly semantic: MemoryTier

  /**
   * @param repository - The shared repository.
   */
  constructor(private readonly repository: MemoryRepository) {
    this.episodic = new MemoryTier(repository, 'episodic')
    this.semantic = new MemoryTier(repository, 'semantic')
  }

  /**
   * Find one memory in either tier.
   * @param id - Memory id.
   * @returns The tier and memory, or `undefined`.
   */
  async find(id: string): Promise<{ tier: MemoryTier; memory: Memory } | undefined> {
    const episodic = await this.episodic.get(id)
    if (episodic !== undefined) return { tier: this.episodic, memory: episodic }
    const semantic = await this.semantic.get(id)
    if (semantic !== undefined) return { tier: this.semantic, memory: semantic }
    return undefined
  }

  /**
   * Every memory in both tiers, with the tier each came from.
   * @returns The memories and their tiers.
   */
  async every(): Promise<{ tier: MemoryTier; memory: Memory }[]> {
    return [
      ...(await this.episodic.all()).map(memory => ({ tier: this.episodic, memory })),
      ...(await this.semantic.all()).map(memory => ({ tier: this.semantic, memory })),
    ]
  }

  /** The repository both tiers share. */
  get store(): MemoryRepository {
    return this.repository
  }
}
