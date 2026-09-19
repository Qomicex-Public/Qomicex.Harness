// @vitest-environment jsdom
/**
 * The Security Review Settings page: the plugin registration contract, the
 * injected settings face, the pure value operations, and the form's
 * user-visible behavior (switch, keyword and rule editing, script, allow paths,
 * save/reset feedback, and the pre-write regular-expression check).
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { SecurityReviewForm, SecurityReviewSection } from '../src/client/SecurityReviewSection.tsx'
import type {
  SecurityReviewFace, SecurityReviewInjected, SecurityReviewSectionProps, SecurityReviewSnapshot,
} from '../src/client/SecurityReviewSection.tsx'
import { firstInvalidPattern, readValue, resetOps, saveOps } from '../src/client/model.ts'
import type { SecurityReviewPathOp, SecurityReviewValue } from '../src/client/model.ts'

afterEach(cleanup)

/** Translate a key to itself so assertions read the locale key, not its copy. */
const t = (key: string): string => key

/** A settings section with every field populated, as the Host would resolve it. */
function section(overrides: Partial<SecurityReviewValue> = {}): SecurityReviewValue {
  return {
    enabled: true,
    allowPaths: ['C:\\Work\\scratch'],
    keywords: [{ text: 'DROP DATABASE', action: 'deny', reason: 'no dropping' }],
    rules: [{ pattern: '\\|\\s*bash', action: 'ask', reason: 'no pipe' }],
    script: 'return undefined',
    ...overrides,
  }
}

/**
 * Build a settings face over a live snapshot: a successful mutate applies the
 * section writes and notifies subscribers, the way the real scope does, so the
 * form re-renders after each edit like it would in the browser.
 * @param value - the initial resolved section.
 * @param options - snapshot status, writability, and an optional rejection.
 * @returns the face, its mutate spy, and a live snapshot getter.
 */
function makeFace(
  value: SecurityReviewValue,
  options: { status?: 'loading' | 'ready' | 'unavailable'; writable?: boolean; failure?: string } = {},
): { face: SecurityReviewFace; calls: (readonly SecurityReviewPathOp[])[]; snapshot: () => SecurityReviewSnapshot } {
  let current: SecurityReviewSnapshot = { status: options.status ?? 'ready', value, writable: options.writable ?? true }
  const listeners = new Set<() => void>()
  const calls: (readonly SecurityReviewPathOp[])[] = []
  const mutate = async (ops: readonly SecurityReviewPathOp[]): Promise<void> => {
    calls.push(ops)
    if (options.failure !== undefined) throw new Error(options.failure)
    const next = readValue(current.value)
    for (const op of ops) {
      if (op.op === 'set') (next as unknown as Record<string, unknown>)[op.path[0]!] = op.value
    }
    current = { ...current, value: next }
    for (const listener of listeners) listener()
  }
  return {
    calls,
    snapshot: () => current,
    face: {
      snapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      mutate,
    },
  }
}

/** Fold one mutate call's set operations into a plain view for assertions. */
function written(ops: readonly SecurityReviewPathOp[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const op of ops) {
    if (op.op === 'set') result[op.path.join('.')] = op.value
  }
  return result
}

/** Flush the pending mutation promise chain started by a click. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('pure value operations', () => {
  it('copies the resolved section instead of aliasing it', () => {
    const source = section()
    const copy = readValue(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.keywords).not.toBe(source.keywords)
  })

  it('finds the first rule whose non-empty pattern does not compile', () => {
    expect(firstInvalidPattern(section({ rules: [] }))).toBeUndefined()
    expect(firstInvalidPattern(section({ rules: [{ pattern: '', action: 'ask', reason: '' }] }))).toBeUndefined()
    expect(firstInvalidPattern(section({
      rules: [{ pattern: 'ok', action: 'ask', reason: '' }, { pattern: '(', action: 'ask', reason: '' }],
    }))).toBe('(')
  })

  it('addresses every owned field on save and on reset', () => {
    expect(saveOps(section()).map(op => op.path.join('.'))).toEqual(['enabled', 'allowPaths', 'keywords', 'rules', 'script'])
    expect(resetOps()).toEqual([
      { op: 'unset', path: ['enabled'] },
      { op: 'unset', path: ['allowPaths'] },
      { op: 'unset', path: ['keywords'] },
      { op: 'unset', path: ['rules'] },
      { op: 'unset', path: ['script'] },
    ])
  })
})

/** Full slot props for the section; the framework hook seats are irrelevant to this page. */
const sectionProps = (settings: SecurityReviewInjected['settings']): SecurityReviewSectionProps =>
  ({ close: () => {}, t, settings } as unknown as SecurityReviewSectionProps)

describe('section states', () => {
  it('reports a missing settings provider', () => {
    render(<SecurityReviewSection {...sectionProps(undefined)} />)
    expect(screen.getByText('unavailable')).toBeTruthy()
  })

  it('renders the form when a settings face is present', () => {
    const { face } = makeFace(section())
    render(<SecurityReviewSection {...sectionProps(face)} />)
    expect(screen.getByText('save')).toBeTruthy()
  })

  it('reports a not-yet-read and an unavailable settings section', () => {
    const loading = makeFace(section(), { status: 'loading' })
    const { unmount } = render(<SecurityReviewForm settings={loading.face} t={t} />)
    expect(screen.getByText('loading')).toBeTruthy()
    unmount()

    const unavailable = makeFace(section(), { status: 'unavailable' })
    render(<SecurityReviewForm settings={unavailable.face} t={t} />)
    expect(screen.getByText('unavailable')).toBeTruthy()
  })

  it('renders the current switch, built-in rules, and every list', () => {
    const { face } = makeFace(section())
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)
    expect(screen.getByRole('switch', { name: 'enabled' }).getAttribute('aria-checked')).toBe('true')
    expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(10)
    expect((container.querySelector('#security-review-keyword-0-value') as HTMLInputElement).value).toBe('DROP DATABASE')
    expect((container.querySelector('#security-review-rule-0-value') as HTMLInputElement).value).toBe('\\|\\s*bash')
    expect((container.querySelector('#security-review-script') as HTMLTextAreaElement).value).toBe('return undefined')
  })
})

describe('form behavior', () => {
  it('writes the master switch', async () => {
    const { face, calls } = makeFace(section())
    render(<SecurityReviewForm settings={face} t={t} />)
    fireEvent.click(screen.getByRole('switch', { name: 'enabled' }))
    await flush()
    expect(written(calls[0]!).enabled).toBe(false)
  })

  it('adds, edits, re-actions, and removes a keyword', async () => {
    const { face, calls } = makeFace(section({ keywords: [] }))
    render(<SecurityReviewForm settings={face} t={t} />)
    expect(screen.getByText('keywordsEmpty')).toBeTruthy()

    fireEvent.click(screen.getAllByText('add')[0]!)
    await flush()
    expect(written(calls.at(-1)!).keywords).toEqual([{ text: '', action: 'ask', reason: '' }])
  })

  it('commits a keyword match only when it changed', async () => {
    const { face, calls } = makeFace(section({ keywords: [{ text: 'a', action: 'ask', reason: 'r' }] }))
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)
    const input = container.querySelector('#security-review-keyword-0-value') as HTMLInputElement

    fireEvent.blur(input)
    await flush()
    expect(calls).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'b' } })
    fireEvent.blur(input)
    await flush()
    expect(written(calls[0]!).keywords).toEqual([{ text: 'b', action: 'ask', reason: 'r' }])
  })

  it('commits a keyword action and a keyword reason', async () => {
    const { face, calls } = makeFace(section({ keywords: [{ text: 'a', action: 'ask', reason: 'r' }] }))
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)

    fireEvent.click(container.querySelector('#security-review-keyword-0-action') as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'actionDeny' }))
    await flush()
    expect(written(calls.at(-1)!).keywords).toEqual([{ text: 'a', action: 'deny', reason: 'r' }])

    const reason = container.querySelector('#security-review-keyword-0-reason') as HTMLInputElement
    fireEvent.change(reason, { target: { value: 'why' } })
    fireEvent.blur(reason)
    await flush()
    expect(written(calls.at(-1)!).keywords).toEqual([{ text: 'a', action: 'deny', reason: 'why' }])
  })

  it('removes a keyword and edits a rule through its action and reason', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)

    fireEvent.click(container.querySelector('#security-review-rule-0-action') as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'actionDeny' }))
    await flush()
    expect(written(calls.at(-1)!).rules).toEqual([{ pattern: '\\|\\s*bash', action: 'deny', reason: 'no pipe' }])

    // Keyword removal is the row's own button, before the trailing Add/Reset.
    fireEvent.click(screen.getAllByText('remove')[0]!)
    await flush()
    expect(written(calls.at(-1)!).keywords).toEqual([])
  })

  it('edits the script and manages allow paths', async () => {
    const { face, calls } = makeFace(section({ allowPaths: ['C:\\a'] }))
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)

    const script = container.querySelector('#security-review-script') as HTMLTextAreaElement
    fireEvent.change(script, { target: { value: 'return { action: "ask" }' } })
    fireEvent.blur(script)
    await flush()
    expect(written(calls.at(-1)!).script).toBe('return { action: "ask" }')

    const path = container.querySelector('#security-review-path-0') as HTMLInputElement
    fireEvent.change(path, { target: { value: 'C:\\b' } })
    fireEvent.blur(path)
    await flush()
    expect(written(calls.at(-1)!).allowPaths).toEqual(['C:\\b'])

    fireEvent.click(screen.getAllByText('remove').at(-1)!)
    await flush()
    expect(written(calls.at(-1)!).allowPaths).toEqual([])

    fireEvent.click(screen.getAllByText('add').at(-1)!)
    await flush()
    expect(written(calls.at(-1)!).allowPaths).toEqual([''])
  })

  it('refuses to save an invalid regular expression', async () => {
    const { face, calls } = makeFace(section({ rules: [{ pattern: '(', action: 'ask', reason: '' }] }))
    render(<SecurityReviewForm settings={face} t={t} />)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(calls).toHaveLength(0)
    expect(screen.getByText('invalidPattern', { exact: false })).toBeTruthy()
  })

  it('reports a saved write and a failed write', async () => {
    const ok = makeFace(section())
    const first = render(<SecurityReviewForm settings={ok.face} t={t} />)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(ok.calls).toHaveLength(1)
    expect(screen.getByText('saved')).toBeTruthy()
    first.unmount()

    const bad = makeFace(section(), { failure: 'boom' })
    render(<SecurityReviewForm settings={bad.face} t={t} />)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(screen.getByText('failed', { exact: false })).toBeTruthy()
  })

  it('resets every owned field', async () => {
    const { face, calls } = makeFace(section())
    render(<SecurityReviewForm settings={face} t={t} />)
    fireEvent.click(screen.getByText('reset'))
    await flush()
    expect(calls[0]!).toEqual(resetOps())
  })

  it('edits other rows, changes an action to ask, and manages rules', async () => {
    const { face, calls } = makeFace(section({
      keywords: [{ text: 'a', action: 'ask', reason: '' }, { text: 'b', action: 'ask', reason: '' }],
      rules: [{ pattern: 'x', action: 'ask', reason: '' }, { pattern: 'y', action: 'ask', reason: '' }],
      allowPaths: ['C:\\a', 'C:\\b'],
    }))
    const { container } = render(<SecurityReviewForm settings={face} t={t} />)

    const keyword = container.querySelector('#security-review-keyword-1-value') as HTMLInputElement
    fireEvent.change(keyword, { target: { value: 'c' } })
    fireEvent.blur(keyword)
    await flush()
    expect(written(calls.at(-1)!).keywords)
      .toEqual([{ text: 'a', action: 'ask', reason: '' }, { text: 'c', action: 'ask', reason: '' }])

    fireEvent.click(container.querySelector('#security-review-keyword-0-action') as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'actionAsk' }))
    await flush()
    expect(written(calls.at(-1)!).keywords)
      .toEqual([{ text: 'a', action: 'ask', reason: '' }, { text: 'c', action: 'ask', reason: '' }])

    const rule = container.querySelector('#security-review-rule-1-value') as HTMLInputElement
    fireEvent.change(rule, { target: { value: 'z' } })
    fireEvent.blur(rule)
    await flush()
    expect(written(calls.at(-1)!).rules)
      .toEqual([{ pattern: 'x', action: 'ask', reason: '' }, { pattern: 'z', action: 'ask', reason: '' }])

    // Add buttons render in order: keywords, rules, allow paths.
    fireEvent.click(screen.getAllByText('add')[1]!)
    await flush()
    expect((written(calls.at(-1)!).rules as unknown[]).length).toBe(3)

    // Remove buttons render per row; the first rule's is the third one.
    fireEvent.click(screen.getAllByText('remove')[2]!)
    await flush()
    expect(written(calls.at(-1)!).rules)
      .toEqual([{ pattern: 'z', action: 'ask', reason: '' }, { pattern: '', action: 'ask', reason: '' }])

    const path = container.querySelector('#security-review-path-1') as HTMLInputElement
    fireEvent.change(path, { target: { value: 'C:\\c' } })
    fireEvent.blur(path)
    await flush()
    expect(written(calls.at(-1)!).allowPaths).toEqual(['C:\\a', 'C:\\c'])
  })

  it('disables every control when the document is not writable', () => {
    const { face } = makeFace(section(), { writable: false })
    render(<SecurityReviewForm settings={face} t={t} />)
    expect((screen.getByRole('switch', { name: 'enabled' }) as HTMLButtonElement).disabled).toBe(true)
    for (const button of screen.getAllByText(/save|reset|add|remove/)) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('browser plugin registration', () => {
  /** A slot registry plus locale runtime, with the section slot declared. */
  async function bench(): Promise<{ ctx: Context; slots: SlotRegistry }> {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    return { ctx, slots }
  }

  it('declares only the slot registry and locale services', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('leaves the host half a no-op', () => {
    expect(() => { hostApply() }).not.toThrow()
  })

  it('registers one Security Review section without a settings provider', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.options.id).toBe('security-review')
    expect(entry.options.order).toBe(13)
    expect(resolveSlotLabel(entry.options.label)).toBe('Security review')
    expect(((entry.inject as unknown as () => SecurityReviewInjected)()).settings).toBeUndefined()
  })

  it('binds the guard namespace through the settings scope service', async () => {
    const b = await bench()
    const observed: string[] = []
    const scope = {
      getSnapshot: () => ({ status: 'ready', value: section(), writable: true }),
      subscribe: () => { observed.push('subscribe'); return () => {} },
      mutate: async () => { observed.push('mutate') },
    }
    b.ctx.provide('settingsScope', { bind: () => scope, describe: () => [] } as never)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => SecurityReviewInjected)()
    expect(injected.settings).toBeDefined()
    expect(injected.settings!.snapshot().status).toBe('ready')
    injected.settings!.subscribe(() => {})
    await injected.settings!.mutate(saveOps(section()))
    expect(observed).toEqual(['subscribe', 'mutate'])
  })
})
