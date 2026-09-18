import { describe, expect, it } from 'vitest'
import {
  UNKNOWN_SCOPE_ID,
  ancestorsOf,
  canAggregateRead,
  canPromote,
  canRead,
  canWrite,
  isAncestor,
  isSameScope,
  parentOf,
  parseScope,
  projectScope,
  readableScopes,
  serializeScope,
  sessionScope,
} from '../src/scope/namespace.ts'
import type { ScopeNode } from '../src/types.ts'

const global: ScopeNode = { kind: 'global' }
const user: ScopeNode = { kind: 'user', userId: 'u1' }
const project = projectScope('C:/repo')
const otherProject = projectScope('C:/other')
const session = sessionScope('C:/repo', 's1')
const task: ScopeNode = { kind: 'task', scope: session, taskId: 't1' }

describe('scope serialization', () => {
  it('round-trips every level', () => {
    for (const node of [global, user, project, session, task]) {
      const wire = serializeScope(node)
      expect(parseScope(wire)).toEqual(node)
    }
  })

  it('encodes nesting without losing the parent', () => {
    expect(serializeScope(project)).toBe('project=unknown/unknown/C%3A%2Frepo')
    expect(serializeScope(session)).toBe('session=project=unknown/unknown/C%3A%2Frepo|s1')
    expect(serializeScope(task)).toBe('task=session=project=unknown/unknown/C%3A%2Frepo|s1|t1')
  })

  it('survives ids that contain the structural separators', () => {
    const nasty = projectScope('C:/repo|a=b/c')
    expect(parseScope(serializeScope(nasty))).toEqual(nasty)
    expect(parseScope(serializeScope(sessionScope('C:/repo|a=b/c', 's/1|2')))).toEqual(
      sessionScope('C:/repo|a=b/c', 's/1|2'),
    )
  })

  it('rejects malformed strings instead of guessing', () => {
    for (const bad of ['', 'globalx', 'user=', 'workspace=a', 'workspace=a/b/c', 'project=a/b', 'session=s1', 'task=', 'nope=1', 'user=%E0%A4%A']) {
      expect(parseScope(bad)).toBeUndefined()
    }
  })
})

describe('scope tree navigation', () => {
  it('walks to the parent and stops at global', () => {
    expect(parentOf(global)).toBeUndefined()
    expect(parentOf(user)).toEqual(global)
    expect(parentOf(session)).toEqual(project)
    expect(parentOf(task)).toEqual(session)
  })

  it('lists ancestors nearest first, without organization', () => {
    // The runtime chain is project → workspace → user → global. `organization`
    // is a declared level with no dsh source, so it must not appear.
    expect(ancestorsOf(task).map(serializeScope)).toEqual([
      serializeScope(session),
      serializeScope(project),
      serializeScope({ kind: 'workspace', userId: UNKNOWN_SCOPE_ID, workspaceId: UNKNOWN_SCOPE_ID }),
      serializeScope({ kind: 'user', userId: UNKNOWN_SCOPE_ID }),
      'global',
    ])
    expect(ancestorsOf(global)).toEqual([])
  })

  it('never puts organization on the ancestor chain', () => {
    for (const node of [project, session, task]) {
      expect(ancestorsOf(node).some(ancestor => ancestor.kind === 'organization')).toBe(false)
    }
  })

  it('treats only strict containment as ancestry', () => {
    expect(isAncestor(project, session)).toBe(true)
    expect(isAncestor(project, project)).toBe(false)
    expect(isAncestor(session, project)).toBe(false)
    expect(isAncestor(otherProject, session)).toBe(false)
  })
})

describe('canRead: current scope and ancestors only', () => {
  it('reads its own region and everything above it', () => {
    expect(canRead(session, session)).toBe(true)
    expect(canRead(project, session)).toBe(true)
    expect(canRead(global, session)).toBe(true)
  })

  it('cannot read a sibling project, a descendant, or a peer session', () => {
    expect(canRead(otherProject, session)).toBe(false)
    expect(canRead(sessionScope('C:/repo', 's2'), session)).toBe(false)
    expect(canRead(task, session)).toBe(false)
  })

  it('keeps project-scoped memory readable across sessions', () => {
    // The reason the plugin writes at project level: a fact about the working
    // directory must survive the conversation that stated it. Session scoping
    // would make every memory invisible to the next session.
    const nextSession = sessionScope('C:/repo', 's2')
    expect(canRead(project, nextSession)).toBe(true)
    // The counter-case, so the fix is not "read everything": a peer session's
    // own scope stays invisible, which is what keeps two conversations apart.
    expect(canRead(session, nextSession)).toBe(false)
  })
})

describe('canWrite: current scope and descendants only', () => {
  it('writes its own region and everything below it', () => {
    expect(canWrite(project, session)).toBe(true)
    expect(canWrite(project, project)).toBe(true)
    expect(canWrite(session, task)).toBe(true)
  })

  it('cannot write to an ancestor or a sibling', () => {
    expect(canWrite(session, project)).toBe(false)
    expect(canWrite(session, global)).toBe(false)
    expect(canWrite(project, otherProject)).toBe(false)
  })
})

describe('canAggregateRead and canPromote', () => {
  it('aggregates only downward', () => {
    expect(canAggregateRead(task, session)).toBe(true)
    expect(canAggregateRead(session, task)).toBe(false)
  })

  it('promotes only upward and never between peers', () => {
    expect(canPromote(session, project)).toBe(true)
    expect(canPromote(project, session)).toBe(false)
    expect(canPromote(project, project)).toBe(false)
    expect(canPromote(otherProject, project)).toBe(false)
  })
})

describe('readableScopes', () => {
  it('returns the scope and its ancestors nearest first', () => {
    expect(readableScopes(project)).toEqual([
      serializeScope(project),
      serializeScope({ kind: 'workspace', userId: UNKNOWN_SCOPE_ID, workspaceId: UNKNOWN_SCOPE_ID }),
      serializeScope({ kind: 'user', userId: UNKNOWN_SCOPE_ID }),
      'global',
    ])
  })
})

describe('isSameScope', () => {
  it('compares by serialized identity, not object identity', () => {
    expect(isSameScope(projectScope('a'), projectScope('a'))).toBe(true)
    expect(isSameScope(projectScope('a'), projectScope('b'))).toBe(false)
  })
})
