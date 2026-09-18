import { describe, expect, it } from 'vitest'
import {
  STANDING_INSTRUCTION_STRENGTH,
  scopeForSignal,
  tierForSignal,
} from '../src/scope/tier.ts'
import { projectScope, serializeScope, userScope } from '../src/scope/namespace.ts'
import type { CaptureSignal } from '../src/types.ts'

function signal(type: CaptureSignal['type'], strength = 0.9): CaptureSignal {
  return { type, strength, epistemic: 'user_stated', sourceType: 'explicit_user' }
}

describe('tierForSignal', () => {
  it('sends a stated preference to the user level', () => {
    // A preference is a property of the person, so it must follow them into
    // every project rather than being relearned in each one.
    expect(tierForSignal(signal('user_preference'))).toBe('user')
  })

  it('sends a standing instruction to the user level', () => {
    expect(tierForSignal(signal('user_statement', STANDING_INSTRUCTION_STRENGTH))).toBe('user')
  })

  it('keeps a project fact at the project level', () => {
    // Both are `user_statement`; the strength is what separates the
    // standing-instruction rule (0.95) from the project-fact rule (0.75).
    expect(tierForSignal(signal('user_statement', 0.75))).toBe('project')
  })

  it('keeps corrections, tool facts, and agent claims at the project level', () => {
    expect(tierForSignal(signal('user_correction'))).toBe('project')
    expect(tierForSignal(signal('tool_verified_fact', 0.85))).toBe('project')
    expect(tierForSignal(signal('agent_claim', 0.5))).toBe('project')
  })

  it('never assigns the global level', () => {
    for (const type of ['user_preference', 'user_statement', 'user_correction', 'tool_verified_fact', 'agent_claim'] as const) {
      expect(['user', 'project']).toContain(tierForSignal(signal(type)))
    }
  })
})

describe('scopeForSignal', () => {
  const user = userScope('u1')
  const project = projectScope('C:/repo', 'u1', 'w1')

  it('writes a preference at the user level', () => {
    expect(scopeForSignal(signal('user_preference'), { user, project })).toBe(user)
  })

  it('writes a project fact at the project level', () => {
    expect(scopeForSignal(signal('tool_verified_fact'), { user, project })).toBe(project)
  })

  it('falls back to the project when the user level is unavailable', () => {
    // Losing the cross-project sharing is better than losing the fact, and the
    // narrower level never leaks into another project.
    expect(scopeForSignal(signal('user_preference'), { user: undefined, project })).toBe(project)
  })

  it('falls back to the user level when only that one resolved', () => {
    expect(scopeForSignal(signal('tool_verified_fact'), { user, project: undefined })).toBe(user)
  })

  it('returns undefined when neither level is available', () => {
    expect(scopeForSignal(signal('user_preference'), { user: undefined, project: undefined })).toBeUndefined()
  })
})

describe('tier scopes stay distinguishable in the namespace', () => {
  it('a user-scope write and a project-scope write serialize differently', () => {
    const user = serializeScope(userScope('u1'))
    const project = serializeScope(projectScope('C:/repo', 'u1', 'w1'))
    expect(user).not.toBe(project)
    expect(user.startsWith('user=')).toBe(true)
    expect(project.startsWith('project=')).toBe(true)
  })
})
