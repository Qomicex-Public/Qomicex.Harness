/**
 * Scope resolution: mapping dsh's real runtime facts onto the namespace tree.
 *
 * Every level here comes from something the harness actually knows. Nothing is
 * invented — a level whose source is unavailable is skipped rather than filled
 * with a placeholder id, because a fabricated id would silently partition the
 * namespace and make memories written under it unreachable.
 *
 * | level | source |
 * |---|---|
 * | global | this harness instance (`~/.qomicex`) |
 * | user | the persisted anonymous user id |
 * | workspace | `ctx.workspaceRegistry.resolveByPath(cwd)` |
 * | project | the session header's cwd |
 * | session | the session id |
 * | task | `ctx.goals.get(agent)` |
 *
 * `organization` has no dsh source and is never constructed; the type keeps it
 * for completeness.
 *
 * @module @deepseek-ai/dsh-memory/src/scope/resolve
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { UNKNOWN_SCOPE_ID, projectScope, sessionScope, userScope, workspaceScope } from './namespace.ts'
import type { ScopeNode } from '../types.ts'

/** The ids one session resolves to, each absent when its source is unavailable. */
export interface ResolvedScopeIds {
  /** Persisted user id; `undefined` when the identity source is unavailable. */
  userId: string | undefined
  /** Workspace id; `undefined` when no workspace owns the working directory. */
  workspaceId: string | undefined
  /** Project id (the canonical working directory); `undefined` without a cwd. */
  projectId: string | undefined
  /** Session id. */
  sessionId: string
  /** Task id (the active goal); `undefined` when no goal is active. */
  taskId: string | undefined
}

/**
 * Read the ids a session resolves to from the services dsh actually provides.
 *
 * Each lookup is optional: a deployment without the workspace registry or the
 * goal service still resolves the levels it does have. Failures are contained
 * to the level that failed — a throwing workspace lookup must not lose the
 * session's project scope.
 * @param ctx - Plugin context.
 * @param agent - The live agent whose session is being resolved.
 * @param userId - The persisted user id, or `undefined` when unavailable.
 * @returns The resolved ids.
 */
export async function resolveScopeIds(
  ctx: Context,
  agent: Agent,
  userId: string | undefined,
): Promise<ResolvedScopeIds> {
  const projectId = agent.session.header.cwd
  return {
    userId,
    workspaceId: await resolveWorkspaceId(ctx, projectId),
    projectId,
    sessionId: agent.session.id,
    taskId: resolveTaskId(ctx, agent),
  }
}

/**
 * Resolve the workspace that owns one directory.
 *
 * `resolveByPath` rejects when the path does not exist, which is a normal case
 * (a session whose working directory was deleted) rather than an error worth
 * propagating, so it is contained here.
 * @param ctx - Plugin context.
 * @param cwd - The session's working directory, when it has one.
 * @returns The workspace id, or `undefined`.
 */
async function resolveWorkspaceId(ctx: Context, cwd: string | undefined): Promise<string | undefined> {
  if (cwd === undefined) return undefined
  const registry = ctx.get('workspaceRegistry') as
    | { resolveByPath(path: string): Promise<{ id: string } | undefined> }
    | undefined
  if (registry === undefined) return undefined
  try {
    return (await registry.resolveByPath(cwd))?.id
  } catch {
    return undefined
  }
}

/**
 * Resolve the active goal's id for one agent.
 * @param ctx - Plugin context.
 * @param agent - The live agent.
 * @returns The goal id, or `undefined` when no goal is active or the service is absent.
 */
function resolveTaskId(ctx: Context, agent: Agent): string | undefined {
  const goals = ctx.get('goals') as { get(agent: Agent): { id: string } | undefined } | undefined
  if (goals === undefined) return undefined
  try {
    return goals.get(agent)?.id
  } catch {
    return undefined
  }
}

/**
 * Build the namespace path a session reads and writes from.
 *
 * Only `session` and `task` are nested nodes; `user`, `workspace`, and
 * `project` are flat and their ancestry is derived by `parentOf`. So the chain
 * is assembled inward: the project node carries the resolved user and
 * workspace ids, the session wraps it, and the task wraps the session.
 *
 * A level whose id is unknown contributes its `unknown` marker rather than
 * being omitted. That is deliberate and the opposite of what it first looks
 * like: omitting the workspace would make `project=u/C%3Arepo` collide across
 * every workspace, while keeping `workspaceId=unknown` keeps the project id
 * itself the discriminator — and the project id is the working directory,
 * which is already unique per project.
 * @param ids - The resolved ids.
 * @returns The session's scope node, or `undefined` when even the project is unknown.
 */
export function scopeFromIds(ids: ResolvedScopeIds): ScopeNode | undefined {
  const { userId, workspaceId, projectId, sessionId, taskId } = ids
  if (projectId === undefined) return undefined

  const project = projectScope(projectId, userId ?? UNKNOWN_SCOPE_ID, workspaceId ?? UNKNOWN_SCOPE_ID)
  const session: ScopeNode = { kind: 'session', scope: project, sessionId }
  return taskId === undefined ? session : { kind: 'task', scope: session, taskId }
}

/**
 * Resolve one session's scope in a single call.
 * @param ctx - Plugin context.
 * @param agent - The live agent whose session is being resolved.
 * @param userId - The persisted user id, or `undefined` when unavailable.
 * @returns The session's scope node, or `undefined` without a working directory.
 */
export async function resolveScope(
  ctx: Context,
  agent: Agent,
  userId: string | undefined,
): Promise<ScopeNode | undefined> {
  return scopeFromIds(await resolveScopeIds(ctx, agent, userId))
}

/** Re-exported so callers build scopes without importing the namespace module too. */
export { projectScope, sessionScope, userScope, workspaceScope }
