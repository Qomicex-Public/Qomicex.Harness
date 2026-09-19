/**
 * Security Review Settings page: the shell-command guard's master switch, its
 * read-only built-in rule list, the user keyword and regular-expression checks,
 * the inline check script, and the recursive-delete allow paths.
 *
 * Every edit is one atomic namespace mutation over the resolved section; a
 * regular-expression rule is checked in the browser before writing, and the
 * Host re-validates the same way, so an unenforceable rule never persists.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SecurityReviewLocaleKey } from './locales.ts'
import {
  firstInvalidPattern, readValue, resetOps, saveOps,
  type KeywordEntry, type PatternEntry, type ReviewAction, type SecurityReviewPathOp, type SecurityReviewValue,
} from './model.ts'
import css from './SecurityReviewSection.module.css'

/** The part of a settings snapshot the page reads. */
export interface SecurityReviewSnapshot {
  /** `loading` before the first read, `ready` once one stands, `unavailable` without a provider. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Resolved section value; meaningful only when `status` is `ready`. */
  readonly value: unknown
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
}

/** The settings face for the guard namespace; absent when no provider is mounted. */
export interface SecurityReviewFace {
  /** Current snapshot of the guard settings section. */
  readonly snapshot: () => SecurityReviewSnapshot
  /** Subscribe to section changes. */
  readonly subscribe: (listener: () => void) => () => void
  /** Apply path-addressed writes to the user section. */
  readonly mutate: (ops: readonly SecurityReviewPathOp[]) => Promise<void>
}

/** Registration-side face used by the page. */
export interface SecurityReviewInjected {
  /** The settings face, or `undefined` when no settings provider is mounted. */
  readonly settings: SecurityReviewFace | undefined
}

/** Full component props assembled by the Settings slot renderer. */
export type SecurityReviewSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.security-review'>
  & InjectFace<SecurityReviewInjected>

/** Built-in rules, shown read-only because the program always enforces them. */
const BUILTINS: readonly SecurityReviewLocaleKey[] = [
  'builtinDeleteHome', 'builtinFormatDisk', 'builtinDeviceWrite', 'builtinForkBomb', 'builtinKillAll',
  'builtinRootChmod', 'builtinRecursiveDelete', 'builtinGitForcePush', 'builtinDestructiveSql', 'builtinPower',
]

/** The page's own feedback line state. */
type Feedback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'invalid'; readonly pattern: string }

/** A row the keyword and rule editors share: one editable match, action, and reason. */
interface RuleRowValue {
  readonly value: string
  readonly action: ReviewAction
  readonly reason: string
}

/**
 * Render the Security Review page.
 * @param props - composed slot props.
 * @returns the page element tree.
 */
export function SecurityReviewSection(props: SecurityReviewSectionProps): ReactNode {
  const { settings, t } = props
  if (settings === undefined) return <p className={css.muted}>{t('unavailable')}</p>
  return <SecurityReviewForm settings={settings} t={t} />
}

/**
 * Render the page form over a mounted settings face.
 * @param props - the settings face and the page's translate seat.
 * @returns the form element tree.
 */
export function SecurityReviewForm(props: {
  readonly settings: SecurityReviewFace
  readonly t: (key: SecurityReviewLocaleKey) => string
}): ReactNode {
  const { settings, t } = props
  const [snapshot, setSnapshot] = useState<SecurityReviewSnapshot>(() => settings.snapshot())
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })

  // A write from anywhere else (another tab, a file edit) has to reach these
  // controls, so the form subscribes instead of caching the first read.
  useEffect(() => {
    setSnapshot(settings.snapshot())
    return settings.subscribe(() => { setSnapshot(settings.snapshot()) })
  }, [settings])

  if (snapshot.status !== 'ready') {
    return <p className={css.muted}>{snapshot.status === 'loading' ? t('loading') : t('unavailable')}</p>
  }

  const value = readValue(snapshot.value)
  const disabled = !snapshot.writable

  const write = async (ops: readonly SecurityReviewPathOp[]): Promise<void> => {
    setFeedback({ kind: 'idle' })
    try {
      await settings.mutate(ops)
      setFeedback({ kind: 'saved' })
    } catch (error) {
      setFeedback({ kind: 'failed', message: String(error) })
    }
  }

  const commit = (next: SecurityReviewValue): void => { void write(saveOps(next)) }

  const keywordRows: RuleRowValue[] = value.keywords.map(entry => ({ value: entry.text, action: entry.action, reason: entry.reason }))
  const patternRows: RuleRowValue[] = value.rules.map(entry => ({ value: entry.pattern, action: entry.action, reason: entry.reason }))

  const setKeywords = (rows: readonly RuleRowValue[]): void => {
    commit({ ...value, keywords: rows.map((row): KeywordEntry => ({ text: row.value, action: row.action, reason: row.reason })) })
  }
  const setPatterns = (rows: readonly RuleRowValue[]): void => {
    commit({ ...value, rules: rows.map((row): PatternEntry => ({ pattern: row.value, action: row.action, reason: row.reason })) })
  }

  const save = (): void => {
    const invalid = firstInvalidPattern(value)
    if (invalid !== undefined) {
      setFeedback({ kind: 'invalid', pattern: invalid })
      return
    }
    commit(value)
  }

  return (
    <div className={css.page}>
      <label className={css.switch}>
        <input
          id="security-review-enabled"
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(event) => { commit({ ...value, enabled: event.target.checked }) }}
        />
        <span className={css.switchLabel}>{t('enabled')}</span>
      </label>
      <p className={css.hint}>{t('enabledHint')}</p>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('builtinsTitle')}</h3>
        <p className={css.hint}>{t('builtinsHint')}</p>
        <ul className={css.builtins}>
          {BUILTINS.map(key => <li key={key}>{t(key)}</li>)}
        </ul>
      </section>

      <StringRuleRows
        idPrefix="security-review-keyword"
        titleKey="keywordsTitle"
        hintKey="keywordsHint"
        emptyKey="keywordsEmpty"
        valueColumnKey="columnValue"
        entries={keywordRows}
        disabled={disabled}
        t={t}
        onAdd={() => { setKeywords([...keywordRows, { value: '', action: 'ask', reason: '' }]) }}
        onRemove={(index) => { setKeywords(keywordRows.filter((_row, i) => i !== index)) }}
        onChange={(index, row) => { setKeywords(keywordRows.map((current, i) => (i === index ? row : current))) }}
      />

      <StringRuleRows
        idPrefix="security-review-rule"
        titleKey="rulesTitle"
        hintKey="rulesHint"
        emptyKey="rulesEmpty"
        valueColumnKey="columnValue"
        entries={patternRows}
        disabled={disabled}
        t={t}
        onAdd={() => { setPatterns([...patternRows, { value: '', action: 'ask', reason: '' }]) }}
        onRemove={(index) => { setPatterns(patternRows.filter((_row, i) => i !== index)) }}
        onChange={(index, row) => { setPatterns(patternRows.map((current, i) => (i === index ? row : current))) }}
      />

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('scriptTitle')}</h3>
        <p className={css.hint}>{t('scriptHint')}</p>
        <TextCell
          id="security-review-script"
          label={t('scriptTitle')}
          placeholder={t('scriptPlaceholder')}
          multiline
          value={value.script}
          disabled={disabled}
          onCommit={(script) => { commit({ ...value, script }) }}
        />
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('allowPathsTitle')}</h3>
        <p className={css.hint}>{t('allowPathsHint')}</p>
        {value.allowPaths.length === 0 && <p className={css.muted}>{t('allowPathsEmpty')}</p>}
        <ul className={css.paths}>
          {value.allowPaths.map((path, index) => (
            <li key={`${String(index)}:${path}`} className={css.pathRow}>
              <TextCell
                id={`security-review-path-${String(index)}`}
                label={t('columnPath')}
                value={path}
                disabled={disabled}
                onCommit={(next) => {
                  commit({ ...value, allowPaths: value.allowPaths.map((current, i) => (i === index ? next : current)) })
                }}
              />
              <Button
                disabled={disabled}
                onClick={() => { commit({ ...value, allowPaths: value.allowPaths.filter((_current, i) => i !== index) }) }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
        <Button disabled={disabled} onClick={() => { commit({ ...value, allowPaths: [...value.allowPaths, ''] }) }}>
          {t('add')}
        </Button>
      </section>

      <div className={css.actions}>
        <Button disabled={disabled} onClick={save}>{t('save')}</Button>
        <Button disabled={disabled} onClick={() => { void write(resetOps()) }}>{t('reset')}</Button>
      </div>
      {feedback.kind === 'saved' && <p className={css.ok}>{t('saved')}</p>}
      {feedback.kind === 'failed' && <p className={css.error}>{t('failed')} {feedback.message}</p>}
      {feedback.kind === 'invalid' && <p className={css.error}>{t('invalidPattern')} {feedback.pattern}</p>}
    </div>
  )
}

/**
 * Render one keyword or regular-expression list.
 * @param props - list identity, rows, copy, and the row callbacks.
 * @returns the list block.
 */
function StringRuleRows(props: {
  readonly idPrefix: string
  readonly titleKey: SecurityReviewLocaleKey
  readonly hintKey: SecurityReviewLocaleKey
  readonly emptyKey: SecurityReviewLocaleKey
  readonly valueColumnKey: SecurityReviewLocaleKey
  readonly entries: readonly RuleRowValue[]
  readonly disabled: boolean
  readonly t: (key: SecurityReviewLocaleKey) => string
  readonly onAdd: () => void
  readonly onRemove: (index: number) => void
  readonly onChange: (index: number, row: RuleRowValue) => void
}): ReactNode {
  const { idPrefix, titleKey, hintKey, emptyKey, valueColumnKey, entries, disabled, t, onAdd, onRemove, onChange } = props
  return (
    <section className={css.block}>
      <h3 className={css.blockTitle}>{t(titleKey)}</h3>
      <p className={css.hint}>{t(hintKey)}</p>
      {entries.length === 0 && <p className={css.muted}>{t(emptyKey)}</p>}
      <ul className={css.rows}>
        {entries.map((row, index) => (
          <li key={`${String(index)}:${row.value}`} className={css.ruleRow}>
            <TextCell
              id={`${idPrefix}-${String(index)}-value`}
              label={t(valueColumnKey)}
              value={row.value}
              disabled={disabled}
              onCommit={(next) => { onChange(index, { ...row, value: next }) }}
            />
            <div className={css.cell}>
              <label className={css.cellLabel} htmlFor={`${idPrefix}-${String(index)}-action`}>{t('columnAction')}</label>
              <select
                id={`${idPrefix}-${String(index)}-action`}
                className={css.input}
                value={row.action}
                disabled={disabled}
                onChange={(event) => { onChange(index, { ...row, action: toAction(event.target.value) }) }}
              >
                <option value="ask">{t('actionAsk')}</option>
                <option value="deny">{t('actionDeny')}</option>
              </select>
            </div>
            <TextCell
              id={`${idPrefix}-${String(index)}-reason`}
              label={t('columnReason')}
              value={row.reason}
              disabled={disabled}
              onCommit={(next) => { onChange(index, { ...row, reason: next }) }}
            />
            <Button disabled={disabled} onClick={() => { onRemove(index) }}>{t('remove')}</Button>
          </li>
        ))}
      </ul>
      <Button disabled={disabled} onClick={onAdd}>{t('add')}</Button>
    </section>
  )
}

/**
 * Narrow a select value to a review action; the options are the only sources.
 * @param value - the select's string value.
 * @returns `deny` for the deny option, `ask` otherwise.
 */
function toAction(value: string): ReviewAction {
  return value === 'deny' ? 'deny' : 'ask'
}

/**
 * A labelled text control that keeps its draft locally until commit.
 *
 * The draft is local until blur so typing does not write on every keystroke,
 * and a value changed elsewhere re-seeds it.
 * @param props - cell identity, current value, and the commit callback.
 * @returns the cell element.
 */
function TextCell(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly onCommit: (next: string) => void
  readonly multiline?: boolean
  readonly placeholder?: string
}): ReactNode {
  const { id, label, value, disabled, onCommit, multiline, placeholder } = props
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <div className={css.cell}>
      <label className={css.cellLabel} htmlFor={id}>{label}</label>
      {multiline === true
        ? (
          <textarea
            id={id}
            className={css.textarea}
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => { setDraft(event.target.value) }}
            onBlur={commit}
          />
        )
        : (
          <input
            id={id}
            className={css.input}
            type="text"
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => { setDraft(event.target.value) }}
            onBlur={commit}
          />
        )}
    </div>
  )
}
