/**
 * The audit log: a record of what the system decided and why, with the two
 * kinds of "why" kept apart.
 *
 * The separation is the point. `supportingMemories` lists every memory that
 * was consulted — usually many, because recall returns what is relevant, not
 * what is decisive. `authorizingEvidence` lists only the grants that actually
 * permitted the action. Collapsing the two would make a later reviewer believe
 * that reading a memory had authorized something, which is exactly the
 * `Memory != Authorization` mistake the whole design avoids.
 *
 * @module @deepseek-ai/dsh-memory/src/security/audit
 */

import type { MemoryRepository } from '../repository.ts'
import type { AuditRecord } from '../repository.ts'
import type { AuthorizationDecision, AuthorizingEvidence } from '../types.ts'

/** Inputs for one audit entry. */
export interface AuditInput {
  /** Action name. */
  action: string
  /** Resource acted on. */
  resource: string
  /** Every memory consulted while deciding. */
  supportingMemories: string[]
  /** The grants that actually authorized the action. */
  authorizingEvidence: AuthorizingEvidence[]
  /** The decision. */
  decision: AuthorizationDecision
  /** Policy version in force. */
  policyVersion: string
  /** Decision time (ms). */
  timestamp: number
}

/**
 * The audit writer. Append-only by construction: it exposes no update or
 * delete, so an entry once written cannot be rewritten.
 */
export class AuditLog {
  /**
   * @param repository - The shared repository.
   */
  constructor(private readonly repository: MemoryRepository) {}

  /**
   * Append one entry.
   * @param input - The decision to record.
   * @returns The stored row's id.
   */
  async record(input: AuditInput): Promise<string> {
    const id = await this.repository.nextId('audit')
    const row: AuditRecord = {
      id,
      action: input.action,
      resource: input.resource,
      supportingMemories: [...input.supportingMemories],
      authorizingEvidence: input.authorizingEvidence.map(grant => ({
        source: grant.source,
        grant: {
          subject: grant.grant.subject ?? null,
          action: grant.grant.action ?? null,
          resource: grant.grant.resource ?? null,
          scope: grant.grant.scope ?? null,
        },
        evidenceIds: grant.evidence.map(item => item.id),
      })),
      decision: {
        allowed: input.decision.allowed,
        reason: input.decision.reason,
        grantIndex: grantIndexOf(input.authorizingEvidence, input.decision.grant),
      },
      policyVersion: input.policyVersion,
      timestamp: input.timestamp,
    }
    await this.repository.putAudit(row)
    return id
  }

  /**
   * Every recorded entry.
   * @returns The audit rows.
   */
  async entries(): Promise<AuditRecord[]> {
    return this.repository.allAudits()
  }

  /**
   * Entries for one action name.
   * @param action - The action name.
   * @returns The matching rows.
   */
  async forAction(action: string): Promise<AuditRecord[]> {
    return (await this.repository.allAudits()).filter(row => row.action === action)
  }
}

/**
 * Link an audit entry onto the memories it referenced, so a memory can be
 * traced forward to the decisions it participated in.
 * @param repository - The shared repository.
 * @param auditId - The audit row's id.
 * @param memoryIds - Memories the entry references.
 * @returns resolution after every memory that exists was updated.
 */
export async function linkAudit(
  repository: MemoryRepository,
  auditId: string,
  memoryIds: readonly string[],
): Promise<void> {
  for (const memoryId of memoryIds) {
    const found = await repository.findMemory(memoryId)
    if (found === undefined) continue
    await repository.updateMemory(found.table, memoryId, current => ({
      ...current,
      governance: {
        ...current.governance,
        auditRefs: current.governance.auditRefs.includes(auditId)
          ? current.governance.auditRefs
          : [...current.governance.auditRefs, auditId],
      },
    }))
  }
}

/**
 * Locate the winning grant in the recorded list.
 *
 * Matches on the grant's *fields*, not object identity: a decision carries its
 * own grant object, and requiring the caller to pass the exact instance that
 * appears in the list would be an aliasing trap rather than a contract.
 * @param grants - Every grant that was considered.
 * @param winner - The grant the decision cites, when it cites one.
 * @returns The index, or `null` when nothing was authorized.
 */
function grantIndexOf(
  grants: readonly AuthorizingEvidence[],
  winner: AuthorizingEvidence | undefined,
): number | null {
  if (grants.length === 0) return null
  if (winner === undefined) return 0
  const index = grants.findIndex(grant =>
    grant.source === winner.source
    && grant.grant.subject === winner.grant.subject
    && grant.grant.action === winner.grant.action
    && grant.grant.resource === winner.grant.resource
    && grant.grant.scope === winner.grant.scope)
  return index < 0 ? 0 : index
}
