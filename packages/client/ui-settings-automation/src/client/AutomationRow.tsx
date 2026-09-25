/**
 * Automation settings rows: the browser selection each later browser start
 * reads, over the `automation` settings namespace the Playwright MCP provider
 * registers on the Host.
 *
 * The rows hold no backend of their own. Writes are path-addressed and reach
 * the next launched browser, not the one already running; a deployment without
 * a settings provider renders them disabled rather than failing.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AutomationRow.module.css'
import type { AutomationLocaleKey } from './locales.ts'

/** Channels the launch resolves, offered in the row's own order. */
const BROWSERS = ['chromium', 'chrome', 'msedge'] as const

/** One selectable browser channel. */
export type AutomationBrowser = typeof BROWSERS[number]

/** The settings rows this package contributes. */
export type AutomationRowField = 'browser' | 'executablePath' | 'headless'

/** Element id one row's control is labelled by. */
const CONTROL_IDS: Record<AutomationRowField, string> = {
  browser: 'automation-browser',
  executablePath: 'automation-executable-path',
  headless: 'automation-headless',
}

/** Dictionary key holding one row's label. */
const LABELS: Record<AutomationRowField, AutomationLocaleKey> = {
  browser: 'browser.label',
  executablePath: 'executablePath.label',
  headless: 'headless.label',
}

/** Dictionary key holding one row's hint. */
const HINTS: Record<AutomationRowField, AutomationLocaleKey> = {
  browser: 'browser.hint',
  executablePath: 'executablePath.hint',
  headless: 'headless.hint',
}

/** Dictionary key holding one channel's display text. */
const BROWSER_LABELS: Record<AutomationBrowser, AutomationLocaleKey> = {
  'chromium': 'browser.chromium',
  'chrome': 'browser.chrome',
  'msedge': 'browser.msedge',
}

/** The part of a settings snapshot the rows read. */
export interface SettingsSnapshotView {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: unknown
  /** Raw user layer as stored; a path present here is an override. */
  readonly user: unknown
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  readonly revision: number | undefined
}

/** One path-addressed write, mirroring the settings Remote operation shape. */
export type SettingsPathOp =
  | { readonly op: 'set'; readonly path: string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: string[] }

/** The settings face, present only when a settings provider is mounted. */
export interface AutomationSettingsFace {
  /** Current snapshot of the automation settings section. */
  readonly snapshot: () => SettingsSnapshotView
  /** Subscribe to section changes. */
  readonly subscribe: (listener: () => void) => () => void
  /** Apply path-addressed writes to the user section. */
  readonly mutate: (ops: readonly SettingsPathOp[]) => Promise<void>
}

/** Registration-side face used by the rows. */
export interface AutomationRowInjected {
  /** The settings face over the provider's profile entry. */
  readonly settings: AutomationSettingsFace
}

/** Full component props assembled by the Settings slot renderer. */
export type AutomationRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.automation'>
  & InjectFace<AutomationRowInjected>

/** The resolved selection the rows edit; the Host schema guarantees these types. */
interface SelectionView {
  readonly browser: AutomationBrowser
  readonly executablePath: string
  readonly headless: boolean
}

/**
 * Read a dotted path out of an unknown section.
 * @param section - The resolved section, or `undefined` before the first read.
 * @param path - Path segments.
 * @returns The value at the path, or `undefined`.
 */
function readPath(section: unknown, path: readonly string[]): unknown {
  let cursor: unknown = section
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** The selection a resolved section expresses, with schema defaults filling gaps. */
function selectionOf(value: unknown): SelectionView {
  const browser = readPath(value, ['browser'])
  return {
    browser: BROWSERS.includes(browser as AutomationBrowser) ? browser as AutomationBrowser : 'chromium',
    executablePath: typeof readPath(value, ['executablePath']) === 'string' ? readPath(value, ['executablePath']) as string : '',
    headless: readPath(value, ['headless']) !== false,
  }
}

/**
 * Render one automation row.
 * @param props - composed slot props (see {@link AutomationRowProps}).
 * @param field - which of the three settings this row edits.
 * @returns the row element tree.
 */
function AutomationRow(props: AutomationRowProps, field: AutomationRowField): ReactNode {
  const { t, settings } = props
  const [snapshot, setSnapshot] = useState<SettingsSnapshotView | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<string>('')

  // The form publishes through a snapshot store, so the rows subscribe rather
  // than polling: a write from anywhere else (another tab, a file edit) has to
  // reach these inputs.
  useEffect(() => {
    setSnapshot(settings.snapshot())
    return settings.subscribe(() => { setSnapshot(settings.snapshot()) })
  }, [settings])

  // `loading` before the first accepted section and `unavailable` when the
  // Host serves no such entry: either way nothing can be edited here yet.
  const unavailable = snapshot === undefined || snapshot.status !== 'ready'
  const selection = unavailable ? undefined : selectionOf(snapshot.value)
  const path = selection?.executablePath ?? ''
  // The draft is local until it commits: a path being typed must not write on
  // every keystroke, and an incoming change replaces it wholesale.
  useEffect(() => { setDraft(path) }, [path])

  const write = async (ops: readonly SettingsPathOp[]): Promise<void> => {
    if (unavailable) return
    setFailure(undefined)
    try {
      await settings.mutate(ops)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const control = (): ReactNode => {
    if (field === 'browser') {
      return (
        <select
          id={CONTROL_IDS.browser}
          className={css.input}
          value={selection?.browser ?? 'chromium'}
          disabled={unavailable}
          onChange={(event) => { void write([{ op: 'set', path: ['browser'], value: event.target.value }]) }}
        >
          {BROWSERS.map(option => (
            <option key={option} value={option}>{t(BROWSER_LABELS[option])}</option>
          ))}
        </select>
      )
    }
    if (field === 'executablePath') {
      return (
        <input
          id={CONTROL_IDS.executablePath}
          className={`${css.input} ${css.pathInput}`}
          type="text"
          value={draft}
          placeholder={t('executablePath.placeholder')}
          disabled={unavailable}
          onChange={(event) => { setDraft(event.target.value) }}
          onBlur={() => {
            const trimmed = draft.trim()
            void write(trimmed === ''
              ? [{ op: 'unset', path: ['executablePath'] }]
              : [{ op: 'set', path: ['executablePath'], value: trimmed }])
          }}
        />
      )
    }
    return (
      <input
        id={CONTROL_IDS.headless}
        className={css.checkbox}
        type="checkbox"
        checked={selection?.headless ?? true}
        disabled={unavailable}
        onChange={(event) => { void write([{ op: 'set', path: ['headless'], value: event.target.checked }]) }}
      />
    )
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <label className={css.label} htmlFor={CONTROL_IDS[field]}>{t(LABELS[field])}</label>
        <span className={css.hint}>
          {t(HINTS[field])}
          {unavailable && ` ${t('unavailable')}`}
        </span>
        {failure !== undefined && <span className={css.error}>{t('saveFailed')} {failure}</span>}
      </div>
      <div className={css.rowControl}>{control()}</div>
    </div>
  )
}

/** The browser channel row registered into the General section. */
export function BrowserRow(props: AutomationRowProps): ReactNode {
  return AutomationRow(props, 'browser')
}

/** The browser executable path row registered into the General section. */
export function BrowserPathRow(props: AutomationRowProps): ReactNode {
  return AutomationRow(props, 'executablePath')
}

/** The headless switch row registered into the General section. */
export function HeadlessRow(props: AutomationRowProps): ReactNode {
  return AutomationRow(props, 'headless')
}
