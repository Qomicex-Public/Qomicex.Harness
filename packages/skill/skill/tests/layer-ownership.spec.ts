/**
 * Skill registry layer ownership: a provider registered through a scoped
 * caller context (an agent preset's standing mount) belongs to that scope's
 * layer, not the registry owner's global layer. The layer a registration lands
 * in decides which agents see it: the preset's agents read it through their
 * scope chain, and the host catalog stays reserved for deployment providers.
 */

import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { afterEach, describe, expect, it } from 'vitest'
import SkillRuntime, { type SkillCandidate, type SkillProvider, type SkillRegistry } from '../src/index.ts'

const contexts: Context[] = []
const scopes: { dispose(): Promise<void> }[] = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function stubProvider(name: string): SkillProvider {
  const candidate: SkillCandidate = {
    name: `${name}-skill`,
    description: `${name} skill`,
    provider: name,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    rank: 100,
    locator: { path: `${name}/SKILL.md`, directory: name },
  }
  return {
    name,
    async list() { return [candidate] },
    async get(candidate) {
      return { ...candidate, content: 'body' }
    },
  }
}

function registryOf(ctx: Context): SkillRegistry {
  for (const key of Object.getOwnPropertySymbols(ctx.reflect.store)) {
    const impl = ctx.reflect.store[key]
    if (impl?.name === 'skills') return impl.value as SkillRegistry
  }
  throw new Error('skill registry not provided')
}

describe('SkillRegistry layer ownership', () => {
  it('registers an unscoped caller into the global layer', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SkillRuntime)
    const dispose = ctx.skills.registerProvider(ctx, () => stubProvider('global-provider'))
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['global-provider-skill'])
    dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('registers a scoped caller into that scope layer, invisible to the global view', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SkillRuntime)
    const registry = registryOf(ctx)
    registry.registerProvider(ctx, () => stubProvider('deployment-provider'))

    const scope = createScope(ctx, {})
    scopes.push(scope)
    const scopedCtx = scope.ctx.extend({})
    registry.registerProvider(scopedCtx, () => stubProvider('preset-provider'))

    // The scoped registration must not collide with the global layer's name
    // table and must not join it: the global view keeps the deployment skill,
    // while the scope view layers the preset skill over it.
    expect((await registry.list()).map(skill => skill.name)).toEqual(['deployment-provider-skill'])
    expect((await registry.list({ scope: scopeOf(scopedCtx) })).map(skill => skill.name))
      .toEqual(['deployment-provider-skill', 'preset-provider-skill'])
  })
})
