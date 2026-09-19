// @vitest-environment jsdom
/**
 * The Personalization Settings page: the plugin registration contract, the
 * injected settings face, and the form's user-visible behavior (defaults,
 * background mode, theme-colour validation, glass, save/reset feedback, and
 * the eyedropper path).
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const imageStore = vi.hoisted(() => ({
  images: new Map<string, Blob>(),
  putImage: vi.fn(),
  getImage: vi.fn(),
  deleteImage: vi.fn(),
}))

vi.mock('../src/client/background-store.ts', () => ({
  BACKGROUND_IMAGE_KEY: 'background',
  CORNER_IMAGE_KEY: 'corner',
  putImage: imageStore.putImage,
  getImage: imageStore.getImage,
  deleteImage: imageStore.deleteImage,
}))
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { PersonalizationForm, PersonalizationSection } from '../src/client/PersonalizationSection.tsx'
import type {
  PersonalizationFace, PersonalizationInjected, PersonalizationSectionProps, PersonalizationSnapshot,
} from '../src/client/PersonalizationSection.tsx'
import { resetOps, saveOps } from '../src/client/model.ts'
import { defaultPersonalizationSettings, type PersonalizationSettings } from '../src/personalization-settings.ts'
import type { PersonalizationPathOp } from '../src/client/model.ts'

afterEach(cleanup)

const createObjectURL = vi.fn((_blob: Blob) => `blob:preview/${String(createObjectURL.mock.calls.length)}`)
const revokeObjectURL = vi.fn()

beforeEach(() => {
  imageStore.images.clear()
  imageStore.putImage.mockReset()
  imageStore.putImage.mockImplementation(async (key: string, blob: Blob) => { imageStore.images.set(key, blob) })
  imageStore.getImage.mockReset()
  imageStore.getImage.mockImplementation(async (key: string) => imageStore.images.get(key))
  imageStore.deleteImage.mockReset()
  imageStore.deleteImage.mockImplementation(async (key: string) => { imageStore.images.delete(key) })
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
})

/** Translate a key to itself so assertions read the locale key, not its copy. */
const t = (key: string): string => key

/** The schema-default value, as the Host would resolve it. */
const section = (overrides: Partial<PersonalizationSettings> = {}): PersonalizationSettings =>
  ({ ...defaultPersonalizationSettings(), ...overrides })

/**
 * Build a settings face over a live snapshot: a successful mutate replaces the
 * matching root fields and notifies subscribers, the way the real scope does.
 * @param value - the initial resolved section.
 * @param options - snapshot status, writability, and an optional rejection.
 * @returns the face, its mutate calls, and a live snapshot getter.
 */
function makeFace(
  value: PersonalizationSettings,
  options: { status?: 'loading' | 'ready' | 'unavailable'; writable?: boolean; failure?: string } = {},
): { face: PersonalizationFace; calls: (readonly PersonalizationPathOp[])[]; snapshot: () => PersonalizationSnapshot } {
  let current: PersonalizationSnapshot = { status: options.status ?? 'ready', value, writable: options.writable ?? true }
  const listeners = new Set<() => void>()
  const calls: (readonly PersonalizationPathOp[])[] = []
  const defaults = defaultPersonalizationSettings() as unknown as Record<string, unknown>
  const mutate = async (ops: readonly PersonalizationPathOp[]): Promise<void> => {
    calls.push(ops)
    if (options.failure !== undefined) throw new Error(options.failure)
    const next = structuredClone(current.value) as Record<string, unknown>
    for (const op of ops) {
      // An unset reverts to the schema default, the way the real scope does.
      if (op.op === 'set') next[op.path[0]!] = op.value
      else next[op.path[0]!] = structuredClone(defaults[op.path[0]!])
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
function written(ops: readonly PersonalizationPathOp[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const op of ops) {
    if (op.op === 'set') result[op.path.join('.')] = op.value
  }
  return result
}

/** Flush the pending mutation promise chain started by a click. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Full slot props for the section; the framework hook seats are irrelevant to this page. */
const sectionProps = (settings: PersonalizationInjected['settings']): PersonalizationSectionProps =>
  ({ t, settings } as unknown as PersonalizationSectionProps)

describe('section states', () => {
  it('reports a missing settings provider', () => {
    render(<PersonalizationSection {...sectionProps(undefined)} />)
    expect(screen.getByText('unavailable')).toBeTruthy()
  })

  it('reports a not-yet-read and an unavailable settings section', () => {
    const loading = makeFace(section(), { status: 'loading' })
    const first = render(<PersonalizationForm settings={loading.face} t={t} />)
    expect(screen.getByText('loading')).toBeTruthy()
    first.unmount()

    const unavailable = makeFace(section(), { status: 'unavailable' })
    render(<PersonalizationForm settings={unavailable.face} t={t} />)
    expect(screen.getByText('unavailable')).toBeTruthy()
  })

  it('renders the schema defaults', () => {
    const { face } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    expect(screen.getByRole('switch', { name: 'enabled' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'glassEnabled' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'glassSidebar' }).getAttribute('aria-checked')).toBe('true')
    expect((container.querySelector('#p13n-glass-blur') as HTMLInputElement).value).toBe('20')
    expect(screen.getByRole('switch', { name: 'cornerEnabled' }).getAttribute('aria-checked')).toBe('false')
    // Background mode defaults to none, so no colour control renders.
    expect(container.querySelector('#p13n-bg-solid')).toBeNull()
  })

  it('disables every control when the document is not writable', () => {
    const { face } = makeFace(section(), { writable: false })
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    for (const control of container.querySelectorAll('input, select, textarea, button')) {
      expect((control as HTMLInputElement | HTMLButtonElement).disabled, control.outerHTML.slice(0, 80)).toBe(true)
    }
  })
})

describe('form behavior', () => {
  it('saves every owned field in one mutation', async () => {
    const { face, calls } = makeFace(section())
    render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(calls).toHaveLength(1)
    expect(saveOps(section()).map(op => (op.op === 'set' ? op.path.join('.') : op.op)))
      .toEqual(Object.keys(written(calls[0]!)))
    expect(screen.getByText('saved')).toBeTruthy()
  })

  it('keeps edits local until save, then writes the draft', async () => {
    const { face, calls } = makeFace(section())
    render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByRole('switch', { name: 'enabled' }))
    await flush()
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(written(calls[0]!).enabled).toBe(false)
  })

  it('reveals the solid colour control when the mode switches and writes it on save', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    const modes = container.querySelectorAll('input[name="p13n-bg-mode"]')
    fireEvent.click(modes[1]!)
    const solid = container.querySelector('#p13n-bg-solid') as HTMLInputElement
    expect(solid).toBeTruthy()
    fireEvent.change(solid, { target: { value: '#112233' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect((written(calls[0]!).background as { mode: string; solid: string }).mode).toBe('solid')
    expect((written(calls[0]!).background as { mode: string; solid: string }).solid).toBe('#112233')
  })

  it('refuses to save an invalid theme colour', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.change(container.querySelector('#p13n-theme-color')!, { target: { value: 'blue' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(calls).toHaveLength(0)
    expect(screen.getByText('invalidColor', { exact: false })).toBeTruthy()
  })

  it('edits glass switches and blur, and writes them on save', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByRole('switch', { name: 'glassCode' }))
    fireEvent.change(container.querySelector('#p13n-glass-blur')!, { target: { value: '30' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    const glass = written(calls[0]!).glass as { code: boolean; blur: number }
    expect(glass.code).toBe(false)
    expect(glass.blur).toBe(30)
  })

  it('resets every owned field and reports a failed write', async () => {
    const ok = makeFace(section())
    const first = render(<PersonalizationForm settings={ok.face} t={t} />)
    fireEvent.click(screen.getByText('reset'))
    await flush()
    expect(ok.calls[0]!).toEqual(resetOps())
    first.unmount()

    const bad = makeFace(section(), { failure: 'boom' })
    render(<PersonalizationForm settings={bad.face} t={t} />)
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(screen.getByText('failed', { exact: false })).toBeTruthy()
  })

  it('picks the theme colour through the eyedropper and clears it', async () => {
    const original = (globalThis as { EyeDropper?: unknown }).EyeDropper
    ;(globalThis as { EyeDropper?: unknown }).EyeDropper = class {
      open(): Promise<{ sRGBHex: string }> { return Promise.resolve({ sRGBHex: '#ABCDEF' }) }
    }
    try {
      const { face, calls } = makeFace(section())
      const { container } = render(<PersonalizationForm settings={face} t={t} />)
      fireEvent.click(screen.getByText('eyedropper'))
      await flush()
      expect((container.querySelector('#p13n-theme-color') as HTMLInputElement).value).toBe('#abcdef')

      fireEvent.click(screen.getByText('clearThemeColor'))
      fireEvent.click(screen.getByText('save'))
      await flush()
      expect(written(calls.at(-1)!).themeColor).toBe('')
    } finally {
      ;(globalThis as { EyeDropper?: unknown }).EyeDropper = original
    }
  })

  it('ignores a cancelled or unsupported eyedropper', async () => {
    const original = (globalThis as { EyeDropper?: unknown }).EyeDropper
    delete (globalThis as { EyeDropper?: unknown }).EyeDropper
    try {
      const { face } = makeFace(section())
      const { container } = render(<PersonalizationForm settings={face} t={t} />)
      fireEvent.click(screen.getByText('eyedropper'))
      await flush()
      expect((container.querySelector('#p13n-theme-color') as HTMLInputElement).value).toBe('')
    } finally {
      ;(globalThis as { EyeDropper?: unknown }).EyeDropper = original
    }
  })
})

describe('background modes', () => {
  it('renders and writes the gradient controls', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(container.querySelectorAll('input[name="p13n-bg-mode"]')[2]!)
    fireEvent.change(container.querySelector('#p13n-bg-from')!, { target: { value: '#000000' } })
    fireEvent.change(container.querySelector('#p13n-bg-to')!, { target: { value: '#ffffff' } })
    fireEvent.change(container.querySelector('#p13n-bg-angle')!, { target: { value: '90' } })
    fireEvent.change(container.querySelector('#p13n-overlay')!, { target: { value: '10' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(written(calls[0]!).background).toMatchObject({
      mode: 'gradient', gradientFrom: '#000000', gradientTo: '#ffffff', angle: 90, overlay: 10,
    })
  })

  it('renders and writes an image URL background', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(container.querySelectorAll('input[name="p13n-bg-mode"]')[3]!)
    fireEvent.click(container.querySelectorAll('input[name="p13n-image-source"]')[1]!)
    fireEvent.change(container.querySelector('#p13n-bg-url')!, { target: { value: ' https://a/b.png ' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(written(calls[0]!).background)
      .toMatchObject({ mode: 'image', imageSource: 'url', imageUrl: 'https://a/b.png' })
  })

  it('uploads, previews, and removes the background image', async () => {
    const { face } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(container.querySelectorAll('input[name="p13n-bg-mode"]')[3]!)
    const picker = container.querySelector('#p13n-bg-file')!
    // A change that carries no file must not attempt an upload.
    fireEvent.change(picker, { target: { files: [] } })
    expect(imageStore.putImage).not.toHaveBeenCalled()

    const file = new File(['bytes'], 'bg.png', { type: 'image/png' })
    fireEvent.change(picker, { target: { files: [file] } })
    await flush()
    expect(imageStore.putImage).toHaveBeenCalledWith('background', file)
    await waitFor(() => { expect(container.querySelector('img')).toBeTruthy() })
    expect(createObjectURL).toHaveBeenCalled()

    fireEvent.click(screen.getByText('imageRemove'))
    await flush()
    expect(imageStore.deleteImage).toHaveBeenCalledWith('background')
  })

  it('reports an image upload failure', async () => {
    imageStore.putImage.mockRejectedValueOnce(new Error('nope'))
    const { face } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(container.querySelectorAll('input[name="p13n-bg-mode"]')[3]!)
    fireEvent.change(container.querySelector('#p13n-bg-file')!, {
      target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
    })
    await flush()
    expect(screen.getByText('imageReadFailed', { exact: false })).toBeTruthy()
  })
})

describe('theme colour and corner controls', () => {
  it('applies a preset and the native colour picker', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByLabelText('#a3d3ff'))
    fireEvent.change(container.querySelector('#p13n-theme-color-picker')!, { target: { value: '#ABCDEF' } })
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(written(calls[0]!).themeColor).toBe('#abcdef')
  })

  it('toggles the glass master switch', async () => {
    const { face, calls } = makeFace(section())
    render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByRole('switch', { name: 'glassEnabled' }))
    fireEvent.click(screen.getByRole('switch', { name: 'glassEnabled' }))
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect((written(calls[0]!).glass as { enabled: boolean }).enabled).toBe(true)
  })

  it('writes corner settings and manages the decoration image', async () => {
    const { face, calls } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    fireEvent.click(screen.getByRole('switch', { name: 'cornerEnabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'positionBottomLeft' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'positionTopRight' }))
    const file = new File(['edge'], 'edge.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('#p13n-corner-file')!, { target: { files: [file] } })
    await flush()
    expect(imageStore.putImage).toHaveBeenCalledWith('corner', file)
    await waitFor(() => { expect(container.querySelectorAll('img').length).toBeGreaterThan(0) })
    fireEvent.click(screen.getByText('cornerRemove'))
    await flush()
    expect(imageStore.deleteImage).toHaveBeenCalledWith('corner')
    fireEvent.click(screen.getByText('save'))
    await flush()
    expect(written(calls[0]!).corner).toMatchObject({ enabled: true, position: 'top-right' })
  })
})

describe('adoption and preview lifecycle', () => {
  it('renders the mountable section over a settings face', () => {
    const { face } = makeFace(section())
    render(<PersonalizationSection {...sectionProps(face)} />)
    expect(screen.getByText('enabledHint')).toBeTruthy()
  })

  it('adopts an external write through the subscription', async () => {
    const { face } = makeFace(section())
    const { container } = render(<PersonalizationForm settings={face} t={t} />)
    await act(async () => { await face.mutate(saveOps(section({ themeColor: '#abcdef' }))) })
    expect((container.querySelector('#p13n-theme-color') as HTMLInputElement).value).toBe('#abcdef')
  })

  it('revokes a stored-image preview URL on unmount', async () => {
    imageStore.images.set('background', new Blob(['stored']))
    const { face } = makeFace(section())
    const { unmount } = render(<PersonalizationForm settings={face} t={t} />)
    await waitFor(() => { expect(createObjectURL).toHaveBeenCalled() })
    unmount()
    expect(revokeObjectURL).toHaveBeenCalled()
  })
})

describe('browser plugin registration', () => {
  /** A slot registry, locale runtime, theme service, and the section declaration. */
  async function bench(): Promise<{ ctx: Context; slots: SlotRegistry }> {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('theme', { overrideTokens: () => () => {} } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    return { ctx, slots }
  }

  it('declares the slot registry, locale, and theme services', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme'])
  })

  it('registers one Personalization section at order 12', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.options.id).toBe('personalization')
    expect(entry.options.order).toBe(12)
    expect(resolveSlotLabel(entry.options.label)).toBe('Personalization')
    expect(((entry.inject as unknown as () => PersonalizationInjected)()).settings).toBeUndefined()
  })

  it('binds the namespace through the settings scope service', async () => {
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
    const injected = (entry.inject as unknown as () => PersonalizationInjected)()
    expect(injected.settings).toBeDefined()
    expect(injected.settings!.snapshot().status).toBe('ready')
    injected.settings!.subscribe(() => {})
    await injected.settings!.mutate(saveOps(section()))
    // One subscribe is the plugin's own settings adoption, the second is the
    // page's; the mutate goes through the same face.
    expect(observed).toEqual(['subscribe', 'subscribe', 'mutate'])
  })

  it('tears the effects down with the plugin fiber', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const styles = document.querySelectorAll('style[data-plugin-css]')
    const mountedStyle = styles[styles.length - 1]!
    expect(mountedStyle.isConnected).toBe(true)
    await fiber.dispose()
    expect(mountedStyle.isConnected).toBe(false)
  })

  it('registers the Host namespace with the guard validate hook', async () => {
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('settings', { register: (namespace: string) => { registered.push(namespace) } } as never)
    hostApply(ctx)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registered).toContain('personalization')
  })

  it('leaves the Host half tolerant of a missing settings service', () => {
    const ctx = new Context()
    expect(() => { hostApply(ctx) }).not.toThrow()
    vi.restoreAllMocks()
  })
})
