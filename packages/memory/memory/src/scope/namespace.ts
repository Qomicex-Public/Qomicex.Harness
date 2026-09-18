/**
 * Scope namespace: a tree, not a linear ladder, and not a permission system.
 * Reading walks up to ancestors; writing walks down to descendants;
 * aggregation reads are explicit and approval-gated. `Scope != Permission`:
 * this module answers "which region of the namespace", never "may this actor".
 * @module @deepseek-ai/dsh-memory/src/scope/namespace
 */

import type { ScopeNode } from '../types.ts'

/** Sentinel used when a scope component cannot be determined. */
export const UNKNOWN_SCOPE_ID = 'unknown'

/**
 * Serialize a scope node to its stable wire form. Every id component is
 * percent-encoded, so the structural separators (`/`, `=`, `|`) can never
 * appear inside one: a project id like `C:/repo` survives the round trip
 * instead of splitting into extra segments.
 * @param node - The scope node.
 * @returns The serialized scope.
 */
export function serializeScope(node: ScopeNode): string {
  switch (node.kind) {
    case 'global':
      return 'global'
    case 'user':
      return `user=${encodeComponent(node.userId)}`
    case 'organization':
      return `organization=${encodeComponent(node.orgId)}`
    case 'workspace':
      return `workspace=${encodeComponent(node.userId)}/${encodeComponent(node.workspaceId)}`
    case 'project':
      return `project=${encodeComponent(node.userId)}/${encodeComponent(node.workspaceId)}/${encodeComponent(node.projectId)}`
    case 'session':
      return `session=${serializeScope(node.scope)}|${encodeComponent(node.sessionId)}`
    case 'task':
      return `task=${serializeScope(node.scope)}|${encodeComponent(node.taskId)}`
  }
}

/** Percent-encode one id component; `/`, `=`, and `|` all become escape sequences. */
function encodeComponent(value: string): string {
  return encodeURIComponent(value)
}

/** Decode one id component; a malformed escape sequence yields `undefined`. */
function decodeComponent(value: string): string | undefined {
  if (value === '') return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

/**
 * Rebuild a scope node from its serialized form.
 * @param value - A string produced by {@link serializeScope}.
 * @returns The parsed node, or `undefined` when the string is not a valid scope.
 */
export function parseScope(value: string): ScopeNode | undefined {
  if (value === 'global') return { kind: 'global' }
  const separator = value.indexOf('=')
  if (separator < 0) return undefined
  const kind = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  switch (kind) {
    case 'user': {
      const userId = decodeComponent(rest)
      return userId === undefined ? undefined : { kind: 'user', userId }
    }
    case 'organization': {
      const orgId = decodeComponent(rest)
      return orgId === undefined ? undefined : { kind: 'organization', orgId }
    }
    case 'workspace': {
      const parts = rest.split('/')
      if (parts.length !== 2) return undefined
      const userId = decodeComponent(parts[0] ?? '')
      const workspaceId = decodeComponent(parts[1] ?? '')
      return userId === undefined || workspaceId === undefined
        ? undefined
        : { kind: 'workspace', userId, workspaceId }
    }
    case 'project': {
      const parts = rest.split('/')
      if (parts.length !== 3) return undefined
      const userId = decodeComponent(parts[0] ?? '')
      const workspaceId = decodeComponent(parts[1] ?? '')
      const projectId = decodeComponent(parts[2] ?? '')
      return userId === undefined || workspaceId === undefined || projectId === undefined
        ? undefined
        : { kind: 'project', userId, workspaceId, projectId }
    }
    case 'session': {
      const index = rest.lastIndexOf('|')
      if (index < 0) return undefined
      const parent = parseScope(rest.slice(0, index))
      const sessionId = decodeComponent(rest.slice(index + 1))
      return parent === undefined || sessionId === undefined
        ? undefined
        : { kind: 'session', scope: parent, sessionId }
    }
    case 'task': {
      const index = rest.lastIndexOf('|')
      if (index < 0) return undefined
      const parent = parseScope(rest.slice(0, index))
      const taskId = decodeComponent(rest.slice(index + 1))
      return parent === undefined || taskId === undefined
        ? undefined
        : { kind: 'task', scope: parent, taskId }
    }
    default:
      return undefined
  }
}

/**
 * The ancestor chain of a node, nearest first, excluding the node itself and
 * ending at `global`.
 * @param node - The scope node.
 * @returns Ancestors from nearest to `global`.
 */
export function ancestorsOf(node: ScopeNode): ScopeNode[] {
  const chain: ScopeNode[] = []
  let current = parentOf(node)
  while (current !== undefined) {
    chain.push(current)
    current = parentOf(current)
  }
  return chain
}

/**
 * The structural parent of a node; `undefined` for `global`.
 *
 * The tree is `global → user → workspace → project → session → task`.
 * `organization` is deliberately absent from it: dsh models no organization or
 * tenant, so there is no id to put there, and an always-`unknown` level would
 * be a fabricated hop rather than a real one. The type keeps its
 * `organization` variant (the document defines seven levels), but no runtime
 * path constructs one.
 * @param node - The scope node.
 * @returns The parent node, or `undefined`.
 */
export function parentOf(node: ScopeNode): ScopeNode | undefined {
  switch (node.kind) {
    case 'global':
      return undefined
    case 'user':
    case 'organization':
      return { kind: 'global' }
    case 'workspace':
      return { kind: 'user', userId: node.userId }
    case 'project':
      return { kind: 'workspace', userId: node.userId, workspaceId: node.workspaceId }
    case 'session':
    case 'task':
      return node.scope
  }
}

/**
 * Whether two nodes denote the same namespace region.
 * @param left - First node.
 * @param right - Second node.
 * @returns `true` when they serialize identically.
 */
export function isSameScope(left: ScopeNode, right: ScopeNode): boolean {
  return serializeScope(left) === serializeScope(right)
}

/**
 * Whether `candidate` is a strict ancestor of `node`.
 * @param candidate - The suspected ancestor.
 * @param node - The node to test.
 * @returns `true` when `candidate` contains `node` and is not equal to it.
 */
export function isAncestor(candidate: ScopeNode, node: ScopeNode): boolean {
  const target = serializeScope(candidate)
  return ancestorsOf(node).some(ancestor => serializeScope(ancestor) === target)
}

/**
 * Read authorization: the current scope and its ancestors only. A memory
 * written to a sibling or descendant region is invisible, which is what makes
 * cross-project leakage structurally impossible rather than policy-enforced.
 * @param target - The scope being read.
 * @param current - The scope reading.
 * @returns `true` when the read is allowed.
 */
export function canRead(target: ScopeNode, current: ScopeNode): boolean {
  return isSameScope(target, current) || isAncestor(target, current)
}

/**
 * Write authorization: the current scope and its descendants only.
 * @param from - The scope writing.
 * @param to - The scope written to.
 * @returns `true` when the write is allowed.
 */
export function canWrite(from: ScopeNode, to: ScopeNode): boolean {
  return isSameScope(from, to) || isAncestor(from, to)
}

/**
 * Aggregated read: only downward, and only with an explicit grant.
 * @param target - The scope being aggregated.
 * @param current - The scope reading.
 * @returns `true` when the aggregate read is structurally allowed.
 */
export function canAggregateRead(target: ScopeNode, current: ScopeNode): boolean {
  return isAncestor(current, target)
}

/**
 * Promotion: upward along the tree only, never between peers, and always
 * approval-gated by the caller.
 * @param from - The originating scope.
 * @param to - The destination scope.
 * @returns `true` when the promotion shape is legal.
 */
export function canPromote(from: ScopeNode, to: ScopeNode): boolean {
  return isAncestor(to, from) && !isSameScope(from, to)
}

/**
 * Every scope the reader can see: itself plus its ancestors.
 * @param current - The scope reading.
 * @returns Serialized readable scopes, nearest first.
 */
export function readableScopes(current: ScopeNode): string[] {
  return [serializeScope(current), ...ancestorsOf(current).map(serializeScope)]
}

/**
 * Build the scope for one session inside a project.
 *
 * `workspaceId` is `unknown` unless a real workspace was resolved; the id is
 * kept in the tree so a memory written before workspace resolution and one
 * written after remain distinguishable rather than silently merged.
 * @param projectId - Project identifier, normally the session's canonical cwd.
 * @param sessionId - Session identifier.
 * @param userId - Owning user id.
 * @param workspaceId - Resolved workspace id, or `UNKNOWN_SCOPE_ID`.
 * @returns The session scope node.
 */
export function sessionScope(
  projectId: string,
  sessionId: string,
  userId: string = UNKNOWN_SCOPE_ID,
  workspaceId: string = UNKNOWN_SCOPE_ID,
): ScopeNode {
  return {
    kind: 'session',
    scope: { kind: 'project', userId, workspaceId, projectId },
    sessionId,
  }
}

/**
 * Build the project scope for one working directory.
 * @param projectId - Project identifier, normally the session's canonical cwd.
 * @param userId - Owning user id.
 * @param workspaceId - Resolved workspace id, or `UNKNOWN_SCOPE_ID`.
 * @returns The project scope node.
 */
export function projectScope(
  projectId: string,
  userId: string = UNKNOWN_SCOPE_ID,
  workspaceId: string = UNKNOWN_SCOPE_ID,
): ScopeNode {
  return { kind: 'project', userId, workspaceId, projectId }
}

/**
 * Build the workspace scope for one resolved workspace.
 * @param workspaceId - The workspace id from the workspace registry.
 * @param userId - Owning user id.
 * @returns The workspace scope node.
 */
export function workspaceScope(workspaceId: string, userId: string = UNKNOWN_SCOPE_ID): ScopeNode {
  return { kind: 'workspace', userId, workspaceId }
}

/**
 * Build the user scope for one user.
 * @param userId - The user id.
 * @returns The user scope node.
 */
export function userScope(userId: string): ScopeNode {
  return { kind: 'user', userId }
}
