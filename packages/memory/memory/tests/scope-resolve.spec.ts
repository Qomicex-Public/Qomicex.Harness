import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveScope, resolveScopeIds, scopeFromIds } from '../src/scope/resolve.ts'
import {
  ancestorsOf,
  canRead,
  projectScope,
  readableScopes,
  serializeScope,
  sessionScope,
  userScope,
  workspaceScope,
} from '../src/scope/namespace.ts'

/** A minimal agent whose session header carries the fields the resolver reads. */
function agent(cwd: string | undefined, id = 's1'): Agent {
  return {
    id,
    session: { id, header: cwd === undefined ? {} : { cwd } },
  } as unknown as Agent
}

/** A context exposing only the services a test wants to provide. */
function ctxWith(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

describe('scope constructors', () => {
  it('round-trips every runtime level through serialize/parse', () => {
    const user = userScope('u1')
    const workspace = workspaceScope('w1', 'u1')
    const project = projectScope('C:/repo', 'u1', 'w1')
    const session = sessionScope('C:/repo', 's1', 'u1', 'w1')
    const task = { kind: 'task', scope: session, taskId: 'g1' } as const
    for (const node of [user, workspace, project, session, task]) {
      expect(readableScopes(node).length).toBeGreaterThan(0)
    }
  })

  it('defaults the user and workspace ids to the unknown marker', () => {
    expect(serializeScope(projectScope('C:/repo'))).toBe('project=unknown/unknown/C%3A%2Frepo')
  })
})

describe('scopeFromIds', () => {
  it('builds session under project under the resolved workspace and user', () => {
    const scope = scopeFromIds({
      userId: 'u1', workspaceId: 'w1', projectId: 'C:/repo', sessionId: 's1', taskId: undefined,
    })
    expect(scope).toBeDefined()
    expect(serializeScope(scope!)).toBe('session=project=u1/w1/C%3A%2Frepo|s1')
  })

  it('nests the task inside the session when a goal is active', () => {
    const scope = scopeFromIds({
      userId: 'u1', workspaceId: 'w1', projectId: 'C:/repo', sessionId: 's1', taskId: 'g1',
    })
    expect(serializeScope(scope!)).toBe('task=session=project=u1/w1/C%3A%2Frepo|s1|g1')
  })

  it('keeps the unknown marker rather than omitting an unresolved level', () => {
    // Omitting the workspace would let `project=u/C%3Arepo` collide across every
    // workspace; the project id is the discriminator that stays unique.
    const scope = scopeFromIds({
      userId: undefined, workspaceId: undefined, projectId: 'C:/repo', sessionId: 's1', taskId: undefined,
    })
    expect(serializeScope(scope!)).toBe('session=project=unknown/unknown/C%3A%2Frepo|s1')
  })

  it('returns undefined without a working directory', () => {
    expect(scopeFromIds({
      userId: 'u1', workspaceId: 'w1', projectId: undefined, sessionId: 's1', taskId: undefined,
    })).toBeUndefined()
  })
})

describe('resolveScopeIds', () => {
  it('reads the workspace id from the registry by canonical path', async () => {
    const ids = await resolveScopeIds(
      ctxWith({ workspaceRegistry: { resolveByPath: () => Promise.resolve({ id: 'w1' }) } }),
      agent('C:/repo'),
      'u1',
    )
    expect(ids).toEqual({ userId: 'u1', workspaceId: 'w1', projectId: 'C:/repo', sessionId: 's1', taskId: undefined })
  })

  it('reads the active goal id as the task id', async () => {
    const ids = await resolveScopeIds(
      ctxWith({ goals: { get: () => ({ id: 'g1' }) } }),
      agent('C:/repo'),
      'u1',
    )
    expect(ids.taskId).toBe('g1')
  })

  it('degrades when the optional services are absent', async () => {
    const ids = await resolveScopeIds(ctxWith({}), agent('C:/repo'), 'u1')
    expect(ids.workspaceId).toBeUndefined()
    expect(ids.taskId).toBeUndefined()
    expect(ids.projectId).toBe('C:/repo')
  })

  it('contains a throwing workspace lookup instead of losing the project scope', async () => {
    const ids = await resolveScopeIds(
      ctxWith({ workspaceRegistry: { resolveByPath: () => Promise.reject(new Error('deleted directory')) } }),
      agent('C:/repo'),
      'u1',
    )
    expect(ids.workspaceId).toBeUndefined()
    expect(ids.projectId).toBe('C:/repo')
  })

  it('contains a throwing goal lookup', async () => {
    const ids = await resolveScopeIds(
      ctxWith({ goals: { get: () => { throw new Error('not the live instance') } } }),
      agent('C:/repo'),
      'u1',
    )
    expect(ids.taskId).toBeUndefined()
  })

  it('skips the workspace lookup without a cwd', async () => {
    let called = false
    const ids = await resolveScopeIds(
      ctxWith({ workspaceRegistry: { resolveByPath: () => { called = true; return Promise.resolve({ id: 'w1' }) } } }),
      agent(undefined),
      'u1',
    )
    expect(called).toBe(false)
    expect(ids.projectId).toBeUndefined()
  })
})

describe('resolveScope', () => {
  it('composes the ids into a session scope', async () => {
    const scope = await resolveScope(
      ctxWith({
        workspaceRegistry: { resolveByPath: () => Promise.resolve({ id: 'w1' }) },
        goals: { get: () => ({ id: 'g1' }) },
      }),
      agent('C:/repo'),
      'u1',
    )
    expect(serializeScope(scope!)).toBe('task=session=project=u1/w1/C%3A%2Frepo|s1|g1')
  })

  it('returns undefined when the session has no working directory', async () => {
    expect(await resolveScope(ctxWith({}), agent(undefined), 'u1')).toBeUndefined()
  })
})

describe('cross-scope visibility on the resolved tree', () => {
  const projectA = projectScope('C:/a', 'u1', 'w1')
  const projectB = projectScope('C:/b', 'u1', 'w1')
  const user = userScope('u1')

  it('shares the user level across projects, which is the point of the level', () => {
    expect(canRead(user, projectB)).toBe(true)
    expect(canRead(user, projectA)).toBe(true)
  })

  it('keeps the project level isolated between projects of one user', () => {
    expect(canRead(projectA, projectB)).toBe(false)
    expect(canRead(projectB, projectA)).toBe(false)
  })

  it('keeps the workspace level isolated between workspaces of one user', () => {
    const workspaceOne = workspaceScope('w1', 'u1')
    const workspaceTwo = workspaceScope('w2', 'u1')
    expect(canRead(workspaceOne, workspaceTwo)).toBe(false)
  })

  it('keeps one user isolated from another user', () => {
    expect(canRead(userScope('u2'), projectA)).toBe(false)
  })

  it('never exposes organization on any runtime chain', () => {
    for (const node of [projectA, projectB, user]) {
      expect(ancestorsOf(node).every(ancestor => ancestor.kind !== 'organization')).toBe(true)
    }
  })
})
