/**
 * Reasoning-effort editor for one custom-provider model row.
 *
 * The host schema (`llm-pi-ai`'s per-model `reasoningEfforts`) accepts
 * `false` — the model cannot reason — or a record whose keys are the levels
 * offered and whose values are the wire spelling each level sends; only
 * `off` may send nothing. An absent field inherits the installed catalog's
 * capability, so this editor distinguishes those three states instead of
 * collapsing them into one.
 */

import type { ReactNode } from 'react'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Every level a pi-ai model may declare, in the host's escalation order. */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One reasoning level. */
export type EffortLevel = typeof EFFORT_LEVELS[number]

/** Wire spellings as stored: a string per level, or `null` for a valueless `off`. */
type EffortRecord = Partial<Record<EffortLevel, string | null>>

/** The locale key naming one level. */
const LEVEL_KEY: Readonly<Record<EffortLevel, ModelsKey>> = {
  off: 'effortOff', minimal: 'effortMinimal', low: 'effortLow', medium: 'effortMedium',
  high: 'effortHigh', xhigh: 'effortXhigh', max: 'effortMax',
}

/** Props of {@link ModelEffortsEditor}. */
interface ModelEffortsEditorProps {
  /** The drafted model row; `reasoningEfforts` is the value edited here. */
  model: DeepSeekModelDraft
  /** Row position in the list, for accessible names. */
  position: number
  /** Disable writes (read-only settings provider). */
  disabled: boolean
  t: (key: ModelsKey) => string
  /** Receive the row with its `reasoningEfforts` rewritten. */
  onChange: (model: DeepSeekModelDraft) => void
}

/** Read the stored value as the record shape, or `undefined` when inherited. */
function recordOf(model: DeepSeekModelDraft): EffortRecord | undefined {
  const value = model['reasoningEfforts']
  return typeof value === 'object' && value !== null ? value : undefined
}

/** Rewrite the field, dropping it entirely when the value stops being declared. */
function withoutEfforts(model: DeepSeekModelDraft): DeepSeekModelDraft {
  return Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'reasoningEfforts'))
}

/**
 * Render the per-model reasoning-effort controls.
 * @param props - the drafted row and its actions.
 * @returns the effort block.
 */
export function ModelEffortsEditor(props: ModelEffortsEditorProps): ReactNode {
  const { model, position, t, disabled } = props
  const stored = model['reasoningEfforts']
  const record = recordOf(model)
  const declared: EffortRecord = record ?? {}
  const wireText = (level: EffortLevel): string => {
    const stored = record?.[level]
    return typeof stored === 'string' ? stored : ''
  }
  const missing = EFFORT_LEVELS.some(level => record?.[level] !== undefined && level !== 'off' && wireText(level).length === 0)
  const write = (next: DeepSeekModelDraft['reasoningEfforts']): void => {
    // An emptied record means inheritance, not a model that offers nothing:
    // dropping the field keeps the host's catalog capability in charge.
    if (typeof next === 'object' && next !== null && Object.keys(next).length === 0) {
      props.onChange(withoutEfforts(model))
      return
    }
    props.onChange(next === undefined ? withoutEfforts(model) : { ...model, reasoningEfforts: next })
  }
  return (
    <div className={styles['effortBlock']} role="group" aria-label={`${t('modelEfforts')} ${String(position)}`}>
      <div className={styles['effortHead']}>
        <span className={styles['modelFieldLabel']}>{t('modelEfforts')}</span>
        <label className={styles['effortDisable']}>
          <input
            type="checkbox"
            checked={stored === false}
            aria-label={`${t('modelEffortsDisable')} ${String(position)}`}
            disabled={disabled}
            onChange={(event) => { write(event.target.checked ? false : undefined) }}
          />
          <span>{t('modelEffortsDisable')}</span>
        </label>
      </div>
      <p className={styles['effortHint']}>
        {stored === false
          ? t('modelEffortsDisableHint')
          : record === undefined ? t('modelEffortsInherited') : t('modelEffortsHint')}
      </p>
      {stored === false
        ? null
        : EFFORT_LEVELS.map((level) => {
          const enabled = record?.[level] !== undefined
          return (
            <div className={styles['effortRow']} key={level}>
              <label className={styles['effortLevel']}>
                <input
                  type="checkbox"
                  checked={enabled}
                  aria-label={`${t(LEVEL_KEY[level])} ${String(position)}`}
                  disabled={disabled}
                  onChange={(event) => {
                    const next: EffortRecord = event.target.checked
                      ? { ...declared, [level]: level === 'off' ? null : level }
                      : Object.fromEntries(Object.entries(declared).filter(([key]) => key !== level))
                    write(next)
                  }}
                />
                <span>{t(LEVEL_KEY[level])}</span>
              </label>
              <input
                className={styles['input']}
                type="text"
                value={enabled ? wireText(level) : ''}
                placeholder={t('modelEffortWirePlaceholder')}
                aria-label={`${t('modelEffortWire')} ${t(LEVEL_KEY[level])} ${String(position)}`}
                aria-invalid={enabled && level !== 'off' && wireText(level).length === 0}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const text = event.target.value
                  const next: EffortRecord = { ...record }
                  Object.assign(next, { [level]: level === 'off' && text.length === 0 ? null : text })
                  write(next)
                }}
              />
            </div>
          )
        })}
      {missing ? <p className={styles['error']}>{t('modelEffortWireRequired')}</p> : null}
    </div>
  )
}
