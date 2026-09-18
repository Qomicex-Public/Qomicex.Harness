/**
 * The authorization plane: the six-tuple check that decides whether an action
 * may run.
 *
 * `Memory != Authorization`. Recall may surface a memory that *says* "always
 * allow bash"; that memory is context, not a permission. Only a grant recorded
 * through this plane — a user statement, an organization policy, a system
 * policy, or a delegated grant — can authorize an action, and the plane
 * matches on the tuple, not on the text of whatever memory was nearby.
 *
 * The plane is off by default. Enabling it changes tool behavior, which is not
 * something a memory plugin should do to a harness without being asked.
 *
 * @module @deepseek-ai/dsh-memory/src/authorization/policy-plane
 */

import { MemoryRepository } from '../repository.ts'
import type { AuditLog } from '../security/audit.ts'
import type { Authorization, AuthorizingEvidence, AuthorizationDecision, Condition } from '../types.ts'

/** The action being requested. */
export interface AuthorizationRequest {
  /** Who is acting. */
  subject: string
  /** What they want to do. */
  action: string
  /** On which resource. */
  resource: string
  /** Serialized scope of the action. */
  scope: string
  /** Conditions that must hold. */
  conditions: Condition[]
}

/** Policy-plane options. */
export interface PolicyPlaneOptions {
  /** The repository, for stored grants. */
  repository: MemoryRepository
  /** The audit log. */
  audit: AuditLog
  /** Policy version stamped into audit entries; read fresh per decision. */
  policyVersion: () => string
  /** Clock seam. */
  clock?: () => number
}

/** The fields the tuple matches on; `conditions` and `expiration` are handled separately. */
const MATCH_FIELDS = ['subject', 'action', 'resource', 'scope'] as const

/** One tuple field name. */
type MatchField = typeof MATCH_FIELDS[number]

/**
 * The policy plane. Deterministic by construction: given the same stored
 * grants and the same request it always reaches the same decision, and it
 * never consults a memory's *content*.
 */
export class PolicyPlane {
  private readonly repository: MemoryRepository
  private readonly audit: AuditLog
  private readonly policyVersion: () => string
  private readonly clock: () => number

  /**
   * @param options - Repository, audit log, policy version, and clock.
   */
  constructor(options: PolicyPlaneOptions) {
    this.repository = options.repository
    this.audit = options.audit
    this.policyVersion = options.policyVersion
    this.clock = options.clock ?? Date.now
  }
  /**
   * Decide one request.
   *
   * Every field must be covered by some grant, and a grant covers a field when
   * it names the exact value or the `*` wildcard. A missing grant for any one
   * field is a denial naming that field, which is what makes a denial
   * diagnosable instead of just "no".
   * @param request - The requested action.
   * @param supportingMemories - Memories consulted while deciding (audited, not authorizing).
   * @returns The decision.
   */
  async authorize(
    request: AuthorizationRequest,
    supportingMemories: readonly string[] = [],
  ): Promise<AuthorizationDecision> {
    const now = this.clock()
    const grants = await this.eligibleGrants(now)

    for (const field of MATCH_FIELDS) {
      const covered = grants.some(grant => covers(grant, field, request[field]))
      if (!covered) {
        const decision: AuthorizationDecision = {
          allowed: false,
          reason: `NO_AUTHORIZATION_FOR_${field.toUpperCase()}`,
        }
        await this.record(request, supportingMemories, grants, decision, now)
        return decision
      }
    }

    const winner = grants.find(grant => MATCH_FIELDS.every(field => covers(grant, field, request[field])))
    const decision: AuthorizationDecision = winner === undefined
      ? { allowed: false, reason: 'NO_SINGLE_GRANT_COVERS_REQUEST' }
      : { allowed: true, reason: 'AUTHORIZED', grant: winner }
    await this.record(request, supportingMemories, grants, decision, now)
    return decision
  }

  /**
   * The grants that are in force at `now`.
   * @param now - Current time (ms).
   * @returns The eligible grants.
   */
  private async eligibleGrants(now: number): Promise<AuthorizingEvidence[]> {
    const rows = await this.repository.allAuthorizations()
    return rows
      .filter(row => row.expiresAt === null || row.expiresAt > now)
      .map(row => MemoryRepository.toAuthorization(row))
  }

  /** Append the audit entry for one decision. */
  private async record(
    request: AuthorizationRequest,
    supportingMemories: readonly string[],
    grants: readonly AuthorizingEvidence[],
    decision: AuthorizationDecision,
    now: number,
  ): Promise<void> {
    await this.audit.record({
      action: request.action,
      resource: request.resource,
      supportingMemories: [...supportingMemories],
      authorizingEvidence: decision.allowed ? [...grants] : [],
      decision,
      policyVersion: this.policyVersion(),
      timestamp: now,
    })
  }
}

/**
 * Whether one grant covers a field's value.
 * @param grant - The grant.
 * @param field - The field being checked.
 * @param value - The requested value.
 * @returns `true` when the grant names the value or `*`.
 */
export function covers(grant: AuthorizingEvidence, field: MatchField, value: string): boolean {
  const claimed = grant.grant[field]
  return claimed === '*' || claimed === value
}

/**
 * Record one grant so the plane can match it later.
 * @param repository - The repository.
 * @param authorization - The granted tuple.
 * @param evidence - Evidence supporting the grant.
 * @returns The stored grant's id.
 */
export async function grant(
  repository: MemoryRepository,
  authorization: Authorization,
  evidence: AuthorizingEvidence['evidence'],
): Promise<string> {
  const id = await repository.nextId('grant')
  await repository.putAuthorization(
    MemoryRepository.fromAuthorization(id, authorization, evidence.map(item => item.id)),
  )
  return id
}
