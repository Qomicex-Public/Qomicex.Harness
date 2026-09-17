// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { QomicexBrandMark, QomicexBrandName, QomicexHeroMark } from '../src/client/Brand.tsx'
import { QOMICEX_MARK_DATA_URL } from '../src/client/mark.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const SIDEBAR_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

/** Every hole this package occupies, as one literal tuple for typed lookups. */
const BRAND_HOLES = [...SIDEBAR_HOLES, HERO_HOLE] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...SIDEBAR_HOLES, HERO_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Qomicex browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills every declared hole before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of BRAND_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of BRAND_HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the mark at the requested edge and the name as text', () => {
    const mark = render(<QomicexBrandMark size={24} />)
    const image = mark.container.querySelector('img')
    expect(image?.getAttribute('width')).toBe('24')
    expect(image?.getAttribute('src')).toBe(QOMICEX_MARK_DATA_URL)
    mark.rerender(<QomicexBrandMark size={34} />)
    expect(mark.container.querySelector('img')?.getAttribute('width')).toBe('34')
    mark.unmount()

    const hero = render(<QomicexHeroMark size={34} className="hero-mark" />)
    expect(hero.container.querySelector('img')?.getAttribute('class')).toBe('hero-mark')
    hero.unmount()

    const name = render(<QomicexBrandName />)
    expect(name.container.textContent).toBe('Qomicex')
  })
})
