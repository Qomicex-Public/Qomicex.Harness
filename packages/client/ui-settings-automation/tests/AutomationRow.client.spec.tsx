// @vitest-environment jsdom
/**
 * The automation settings rows: the resolved selection each renders, the three
 * writes, the disabled state without a settings service, the failure surface,
 * and the subscription that keeps an external write visible.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPathRow, BrowserRow, HeadlessRow } from '../src/client/AutomationRow.tsx'
import type {
  AutomationRowProps, AutomationSettingsFace, SettingsPathOp, SettingsSnapshotView,
} from '../src/client/AutomationRow.tsx'
import { en, type AutomationLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: AutomationLocaleKey): string => en[key]) as AutomationRowProps['t']

/** A settings face over a mutable resolved value. */
function face(options: { value?: unknown; failure?: string } = {}) {
  let value = options.value ?? { browser: 'chromium', headless: true }
  let listener: (() => void) | undefined
  const snapshot = (): SettingsSnapshotView => ({ status: 'ready', value, user: value, writable: true, revision: 1 })
  const mutate = vi.fn(async (ops: readonly SettingsPathOp[]): Promise<void> => {
    if (options.failure !== undefined) throw new Error(options.failure)
    for (const op of ops) {
      value = op.op === 'set' ? { ...value as Record<string, unknown>, [op.path[0]!]: op.value } : value
    }
    listener?.()
  })
  return {
    face: {
      snapshot,
      subscribe: (next: () => void) => { listener = next; return () => { listener = undefined } },
      mutate,
    } satisfies AutomationSettingsFace,
    mutate,
  }
}

/** Props for one row; only `field` and the shared framework seats matter here. */
function props(settings: AutomationSettingsFace): AutomationRowProps {
  return { t, close: () => {}, settings } as unknown as AutomationRowProps
}

describe('automation settings rows', () => {
  it('renders the resolved selection', async () => {
    render(<BrowserRow {...props(face({ value: { browser: 'chrome' } }).face)} />)
    await waitFor(() => { expect((screen.getByLabelText<HTMLSelectElement>('Browser')).value).toBe('chrome') })
  })

  it('falls back to the schema defaults when a field is absent', async () => {
    render(<BrowserRow {...props(face({ value: {} }).face)} />)
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('Browser').value).toBe('chromium') })
  })

  it('falls back to the schema defaults when the section is not an object', async () => {
    render(<BrowserRow {...props(face({ value: 'nonsense' }).face)} />)
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('Browser').value).toBe('chromium') })
  })

  it('disables every control when the namespace is not served', async () => {
    const unavailable = {
      snapshot: (): SettingsSnapshotView => ({ status: 'unavailable', value: undefined, user: undefined, writable: false, revision: undefined }),
      subscribe: () => () => {},
      mutate: vi.fn(async (): Promise<void> => {}),
    } satisfies AutomationSettingsFace
    render(<>
      <BrowserRow {...props(unavailable)} />
      <BrowserPathRow {...props(unavailable)} />
      <HeadlessRow {...props(unavailable)} />
    </>)
    await waitFor(() => { expect(screen.getAllByText(/No settings service/)).toHaveLength(3) })
    expect(screen.getByLabelText<HTMLSelectElement>('Browser').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Browser path').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Headless').disabled).toBe(true)
    // A disabled control still reaches its handler when an event is forced, and
    // the write must drop it rather than touch an unserved form.
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>('Browser'), { target: { value: 'msedge' } })
    expect(screen.queryByText(/Failed to save/)).toBeNull()
  })

  it('writes the selected browser channel', async () => {
    const { face: settings, mutate } = face()
    render(<BrowserRow {...props(settings)} />)
    fireEvent.change(await waitFor(() => screen.getByLabelText<HTMLSelectElement>('Browser')), { target: { value: 'msedge' } })
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['browser'], value: 'msedge' }]) })
  })

  it('writes the path on blur and clears an emptied field', async () => {
    const { face: settings, mutate } = face({ value: { browser: 'chromium', executablePath: '/opt/chrome' } })
    render(<BrowserPathRow {...props(settings)} />)
    const input = await waitFor(() => screen.getByLabelText<HTMLInputElement>('Browser path'))
    fireEvent.change(input, { target: { value: ' /opt/other ' } })
    fireEvent.blur(input)
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['executablePath'], value: '/opt/other' }]) })
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['executablePath'] }]) })
  })

  it('writes the headless switch', async () => {
    const { face: settings, mutate } = face()
    render(<HeadlessRow {...props(settings)} />)
    fireEvent.click(await waitFor(() => screen.getByLabelText<HTMLInputElement>('Headless')))
    await waitFor(() => { expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['headless'], value: false }]) })
  })

  it('surfaces a refused write instead of dropping it', async () => {
    const { face: settings } = face({ failure: 'read-only document' })
    render(<HeadlessRow {...props(settings)} />)
    fireEvent.click(await waitFor(() => screen.getByLabelText<HTMLInputElement>('Headless')))
    await waitFor(() => { expect(screen.getByText(/read-only document/)).toBeTruthy() })
  })

  it('renders a non-Error rejection as its text', async () => {
    const rejecter = {
      snapshot: () => ({ status: 'ready' as const, value: {}, user: {}, writable: true, revision: 1 }),
      subscribe: () => () => {},
      mutate: vi.fn(async (): Promise<void> => { throw 'cordis is down' }),
    }
    render(<HeadlessRow {...props(rejecter)} />)
    fireEvent.click(await waitFor(() => screen.getByLabelText<HTMLInputElement>('Headless')))
    await waitFor(() => { expect(screen.getByText(/cordis is down/)).toBeTruthy() })
  })

  it('re-renders when an external write publishes a new snapshot', async () => {
    const { face: settings } = face()
    render(<BrowserRow {...props(settings)} />)
    await waitFor(() => { expect((screen.getByLabelText<HTMLSelectElement>('Browser')).value).toBe('chromium') })
    fireEvent.change(screen.getByLabelText<HTMLSelectElement>('Browser'), { target: { value: 'chrome' } })
    await waitFor(() => {
      expect((screen.getByLabelText<HTMLSelectElement>('Browser')).value).toBe('chrome')
    })
  })
})
