/**
 * Scope promotion: moving a memory up the namespace tree, which is the one
 * write direction that can leak a fact out of the project that produced it.
 *
 * Promotion is not a write. A memory keeps its own scope; a promotion record
 * says "this memory is now also visible above its origin". That distinction
 * matters because the alternative — rewriting `memory.scope` — would destroy
 * the record of where the fact came from, and the origin is what the tombstone
 * check depends on.
 *
 * The check is structural first (`canPromote`: upward only, never between
 * peers) and approval-gated second. S009 is the second half: a project memory
 * asking to become global is held, not applied.
 *
 * @module @deepseek-ai/dsh-memory/src/authorization/scope-promotion
 */

import { canPromote, parseScope, serializeScope } from '../scope/namespace.ts'
import type { MemoryRepository } from '../repository.ts'
import type { Memory } from '../types.ts'

/** One promotion request. */
export interface PromotionRequest {
  /** Memory to promote. */
  memoryId: string
  /** Serialized destination scope. */
  toScope: string
  /** Why it is being promoted. */
  reason: string
  /** The agent asking, when the caller has one; forwarded to the approval port. */
  agent?: unknown
}

/** The outcome of one promotion attempt. */
export type PromotionOutcome =
  | { kind: 'promoted'; approvalId: string; fromScope: string; toScope: string }
  | { kind: 'rejected'; reason: string }

/**
 * The approval port: whatever the caller uses to ask a human.
 *
 * A port rather than a direct `ctx.approval` call because the approval service
 * needs the asking agent and a tool name for presentation, which only the
 * caller has. It also keeps the gate testable without a live approval service.
 */
export interface ApprovalPort {
  /**
   * Ask the user to confirm one promotion.
   * @param request - What is being promoted, why, and who is asking.
   * @returns `true` only on an explicit grant.
   */
  requestApproval(request: {
    memory: Memory
    toScope: string
    reason: string
    agent: unknown
  }): Promise<boolean>
}

/** Scope promotion options. */
export interface ScopePromotionOptions {
  /** The repository. */
  repository: MemoryRepository
  /**
   * Scopes that require explicit approval before a promotion lands. `global`
   * is here by default: making a project fact visible to every session is
   * exactly the operation that should be asked about.
   */
  approvalScopes: readonly string[]
  /** How to ask the user. Omitted means approval-scoped promotions are refused. */
  approval?: ApprovalPort
  /** Clock seam. */
  clock?: () => number
}

/**
 * The scope-promotion gate.
 */
export class ScopePromotionGate {
  private readonly repository: MemoryRepository
  private readonly approvalScopes: readonly string[]
  private readonly approval: ApprovalPort | undefined
  private readonly clock: () => number

  /**
   * @param options - Repository, approval scopes, approval port, and clock.
   */
  constructor(options: ScopePromotionOptions) {
    this.repository = options.repository
    this.approvalScopes = options.approvalScopes
    this.approval = options.approval
    this.clock = options.clock ?? Date.now
  }

  /**
   * Evaluate one promotion.
   *
   * Order: the memory must exist, the shape must be a legal promotion, and —
   * when the destination needs it — the user must approve. A structural
   * failure is a rejection (there is nothing to approve), and a refused or
   * unavailable approval is a rejection too: a promotion that nobody approved
   * has not happened.
   * @param request - The promotion request.
   * @returns The outcome.
   */
  async request(request: PromotionRequest): Promise<PromotionOutcome> {
    const found = await this.repository.findMemory(request.memoryId)
    if (found === undefined) return { kind: 'rejected', reason: 'UNKNOWN_MEMORY' }
    const from = parseScope(found.memory.scope)
    const to = parseScope(request.toScope)
    if (from === undefined || to === undefined) return { kind: 'rejected', reason: 'MALFORMED_SCOPE' }
    if (!canPromote(from, to)) return { kind: 'rejected', reason: 'ILLEGAL_PROMOTION_DIRECTION' }

    const destination = serializeScope(to)
    if (this.approvalScopes.includes(destination)) {
      // No port means no way to ask, and an unasked promotion is refused
      // rather than assumed: silence is not consent.
      if (this.approval === undefined) {
        return { kind: 'rejected', reason: 'APPROVAL_UNAVAILABLE' }
      }
      const granted = await this.approval.requestApproval({
        memory: found.memory,
        toScope: destination,
        reason: request.reason,
        agent: request.agent,
      })
      if (!granted) return { kind: 'rejected', reason: 'APPROVAL_DENIED' }
    }

    const approvalId = await this.recordApproval(found.memory, request, 'granted')
    await this.repository.updateMemory(found.table, request.memoryId, current => ({
      ...current,
      governance: {
        ...current.governance,
        approvals: current.governance.approvals.includes(approvalId)
          ? current.governance.approvals
          : [...current.governance.approvals, approvalId],
      },
    }))
    return { kind: 'promoted', approvalId, fromScope: found.memory.scope, toScope: destination }
  }

  /**
   * Record one promotion decision as a grant, so the plane can see it.
   * @param memory - The memory being promoted.
   * @param request - The request.
   * @param state - Whether it is granted or pending.
   * @returns The approval record id.
   */
  private async recordApproval(
    memory: Memory,
    request: PromotionRequest,
    state: 'granted' | 'pending',
  ): Promise<string> {
    const id = await this.repository.nextId('approval')
    await this.repository.putAuthorization({
      id,
      source: 'explicit_user_grant',
      grant: {
        subject: null,
        action: state === 'granted' ? 'promote' : null,
        resource: memory.identity.id,
        scope: request.toScope,
      },
      evidenceIds: memory.epistemic.evidence.map(item => item.id),
      createdAt: this.clock(),
      expiresAt: null,
    })
    return id
  }
}

/**
 * Whether one memory's fact is visible from a scope, considering its
 * promotions. Promotions are additive: a promoted memory keeps its own scope.
 * @param memory - The memory.
 * @param readableScopes - Serialized scopes the reader can see.
 * @param approvals - Grant ids that have been applied.
 * @returns `true` when the memory is visible.
 */
export function isPromotedInto(
  memory: Memory,
  readableScopes: readonly string[],
  approvals: readonly string[],
): boolean {
  if (readableScopes.includes(memory.scope)) return true
  return memory.governance.approvals.some(approval => approvals.includes(approval))
}
