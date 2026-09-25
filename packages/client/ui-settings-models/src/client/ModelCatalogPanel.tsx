/**
 * Compact model catalog panel shared by both adapter editors.
 *
 * The reference design replaces the per-row disclosure with one panel: models
 * are chips (name, capacity summary, remove), the selected chip's settings sit
 * inline below, capacities offer preset chips beside the exact number inputs,
 * and reasoning effort is a single-select chip row. Effort writes the level
 * name as its wire value — the page exposes no per-level wire editing, so a
 * gateway that wants a different spelling stays a `cordis.patch.yml` edit.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One capacity's editable text and adapter-specific inherited hint. */
interface CapacityInput {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur?: () => void
}

/** Context-window presets from the reference panel, in escalation order. */
const CONTEXT_PRESETS: readonly number[] = [128_000, 256_000, 312_000, 500_000, 1_000_000]

/** Max-output presets from the reference panel, in escalation order. */
const MAX_PRESETS: readonly number[] = [4_000, 8_000, 16_000, 32_000, 128_000]

/** Props of {@link ModelCatalogPanel}. */
interface ModelCatalogPanelProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Disable every mutation. */
  disabled: boolean
  /** The row's input-modality field name, per adapter. */
  inputField: 'inputModalities' | 'input'
  /** Installed-catalog input types per model id, for rows that declare none. */
  inputDefaults?: ReadonlyMap<string, readonly string[]> | undefined
  /** Route-level input types when neither the row nor the catalog answers. */
  routeDefaultInput?: readonly string[] | undefined
  /** Whether the route input types are still loading. */
  inputLoading?: boolean
  /** Whether the selected row discloses the reasoning-effort chips. */
  efforts?: boolean
  /** Fallback context capacity for an unset field's placeholder. */
  defaultContextWindow?: number | undefined
  /** Fallback output cap for an unset field's placeholder. */
  defaultMaxTokens?: number | undefined
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Apply one row's field patch; an emptied value leaves the row. */
  onPatchRow: (index: number, patch: Record<string, string | number | undefined>) => void
  /** Replace one row wholesale. */
  onReplaceRow: (index: number, row: DeepSeekModelDraft) => void
  /** Drop one row. */
  onRemoveRow: (index: number) => void
}

/** Spell a stored count for a field that may be unset. */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Read one row's stored count. */
function numberOf(model: DeepSeekModelDraft, field: 'contextWindow' | 'maxTokens'): number | undefined {
  const value = model[field]
  return typeof value === 'number' ? value : undefined
}

/** Read one row's declared text. */
function textOf(model: DeepSeekModelDraft, field: 'id' | 'name'): string {
  const value = model[field]
  return typeof value === 'string' ? value : ''
}

/**
 * The selected row's declared input types, or the inherited answer. An absent
 * or empty declaration inherits, matching the host schema: `[]` describes a
 * model that accepts nothing, which a settings page cannot express as intent.
 */
function inputTypes(model: DeepSeekModelDraft, field: 'inputModalities' | 'input', fallback: readonly string[] | undefined): readonly string[] {
  const value = model[field]
  return Array.isArray(value) && value.length > 0 ? value as string[] : fallback ?? ['text']
}

/**
 * Render the compact model catalog panel.
 * @param props - drafted rows and their owning editor's actions.
 * @returns the catalog panel.
 */
export function ModelCatalogPanel(props: ModelCatalogPanelProps): ReactNode {
  const { models, t, disabled } = props
  const [selected, setSelected] = useState(0)
  const [query, setQuery] = useState('')
  // Adding a row selects it, so the settings panel is where the user just
  // landed instead of staying on whichever row happened to be open.
  const rowCount = useRef(models.length)
  useEffect(() => {
    if (models.length > rowCount.current) setSelected(models.length - 1)
    rowCount.current = models.length
  }, [models.length])
  // A reset or a removal replaces the rows the buffers annotated: an entry
  // whose model is gone is dropped rather than resurfacing on a later row.
  const liveIds = useMemo(() => new Set(models.map(model => textOf(model, 'id'))), [models])
  useEffect(() => {
    setEditing((current) => {
      const next = new Map([...current].filter(([key]) => liveIds.has(key.slice(0, key.lastIndexOf(':')))))
      return next.size === current.size ? current : next
    })
  }, [liveIds])
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1M` mid-word. Unreadable text stays past blur so the save-time
  // rejection names a row the user can still see; keys carry the row index
  // because removal moves them.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(() => new Map())
  const clamped = Math.min(selected, Math.max(models.length - 1, 0))
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return models.map((model, index) => ({ model, index }))
      .filter(entry => needle.length === 0
        || textOf(entry.model, 'id').toLowerCase().includes(needle)
        || textOf(entry.model, 'name').toLowerCase().includes(needle))
  }, [models, query])
  const current = models[clamped]
  /** The buffer key of one row's capacity field; a row is identified by its id so a removal never shifts a key. */
  const bufferKey = (model: DeepSeekModelDraft, field: 'contextWindow' | 'maxTokens'): string =>
    `${textOf(model, 'id')}:${field}`
  /** One capacity's editable text for the selected row. */
  const capacityInput = (field: 'contextWindow' | 'maxTokens', fallback: number | undefined): CapacityInput => {
    /* v8 ignore next -- the settings block renders only with a selected row */
    const row = current ?? {}
    const key = bufferKey(row, field)
    return {
      value: editing.get(key) ?? capacitySpelling(numberOf(row, field)),
      placeholder: fallback === undefined
        ? t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
        : formatCapacity(fallback),
      onChange: (text) => {
        setEditing(currentEdits => new Map(currentEdits).set(key, text))
        props.onPatchRow(clamped, { [field]: parseCapacity(text) })
      },
      onBlur: () => {
        // Unreadable text stays on screen: dropping the buffer would render the
        // stored NaN, and the save-time rejection needs a field the user can see.
        const typed = editing.get(key)
        const parsed = typed === undefined ? undefined : parseCapacity(typed)
        if (parsed === undefined || !Number.isNaN(parsed)) {
          setEditing((currentEdits) => {
            const next = new Map(currentEdits)
            next.delete(key)
            return next
          })
        }
      },
    }
  }
  return (
    <div className={styles['modelPanel']}>
      <input
        className={styles['input']}
        type="search"
        value={query}
        placeholder={t('modelFilterPlaceholder')}
        aria-label={t('modelFilter')}
        disabled={disabled}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {models.length === 0
        ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p>
        : (
          <div className={styles['modelChips']} role="listbox" aria-label={t('models')}>
            {visible.map(({ model, index }) => (
              <button
                type="button"
                key={index}
                role="option"
                aria-selected={index === clamped}
                className={index === clamped ? styles['modelChipActive'] : styles['modelChip']}
                disabled={disabled}
                onClick={() => { setSelected(index) }}
              >
                <span className={styles['modelChipName']}>{textOf(model, 'name') || textOf(model, 'id')}</span>
                <span className={styles['modelChipMeta']}>
                  {[capacitySpelling(numberOf(model, 'contextWindow')), capacitySpelling(numberOf(model, 'maxTokens'))]
                    .filter(part => part.length > 0)
                    .join(' · ')}
                </span>
                <span
                  className={styles['modelChipRemove']}
                  role="button"
                  aria-label={`${t('removeModel')} ${String(index + 1)}`}
                  title={t('removeModel')}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onRemoveRow(index)
                    // The row after the removal moves into range; keep the
                    // selection on a row that still exists.
                    setSelected(current => Math.min(current, models.length - 2))
                  }}
                >
                  <IconCloseOutlineRegular size={12} />
                </span>
              </button>
            ))}
          </div>
        )}
      {current === undefined || models.length === 0
        ? null
        : (
          <div className={styles['modelSettings']}>
            <div className={styles['modelFieldRow']}>
              <label className={styles['modelField']}>
                <span className={styles['modelFieldLabel']}>{t('modelId')} {String(clamped + 1)}</span>
                <input
                  className={styles['input']}
                  type="text"
                  value={textOf(current, 'id')}
                  placeholder={t('modelId')}
                  aria-label={`${t('modelId')} ${String(clamped + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { props.onPatchRow(clamped, { id: event.target.value }) }}
                  onBlur={(event) => {
                    // Surrounding whitespace is a paste artifact the adapter
                    // would never match, so it settles on blur.
                    const trimmed = event.target.value.trim()
                    if (trimmed !== event.target.value) props.onPatchRow(clamped, { id: trimmed })
                  }}
                />
              </label>
              <label className={styles['modelField']}>
                <span className={styles['modelFieldLabel']}>{t('modelName')} {String(clamped + 1)}</span>
                <input
                  className={styles['input']}
                  type="text"
                  value={textOf(current, 'name')}
                  placeholder={t('modelNamePlaceholder')}
                  aria-label={`${t('modelName')} ${String(clamped + 1)}`}
                  disabled={disabled}
                  onChange={(event) => {
                    // Clearing the optional name drops it, so an empty string
                    // never reaches a schema that validates names as non-empty.
                    props.onPatchRow(clamped, { name: event.target.value === '' ? undefined : event.target.value })
                  }}
                />
              </label>
            </div>
            <div className={styles['modelChipRow']} role="group" aria-label={t('contextPresets')}>
              {CONTEXT_PRESETS.map(preset => (
                <button
                  type="button"
                  key={preset}
                  aria-pressed={numberOf(current, 'contextWindow') === preset}
                  className={styles['modelChip']}
                  disabled={disabled}
                  onClick={() => { props.onPatchRow(clamped, { contextWindow: preset }) }}
                >
                  {formatCapacity(preset)}
                </button>
              ))}
            </div>
            <div className={styles['modelChipRow']} role="group" aria-label={t('maxPresets')}>
              {MAX_PRESETS.map(preset => (
                <button
                  type="button"
                  key={preset}
                  aria-pressed={numberOf(current, 'maxTokens') === preset}
                  className={styles['modelChip']}
                  disabled={disabled}
                  onClick={() => { props.onPatchRow(clamped, { maxTokens: preset }) }}
                >
                  {formatCapacity(preset)}
                </button>
              ))}
            </div>
            <div className={styles['modelFieldRow']}>
              <label className={styles['modelField']}>
                <span className={styles['modelFieldLabel']}>{t('contextWindow')}</span>
                <input
                  className={styles['input']}
                  type="text"
                  inputMode="numeric"
                  value={capacityInput('contextWindow', props.defaultContextWindow).value}
                  placeholder={capacityInput('contextWindow', props.defaultContextWindow).placeholder}
                  aria-label={`${t('contextWindow')} ${String(clamped + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { capacityInput('contextWindow', props.defaultContextWindow).onChange(event.target.value) }}
                  onBlur={capacityInput('contextWindow', props.defaultContextWindow).onBlur}
                />
              </label>
              <label className={styles['modelField']}>
                <span className={styles['modelFieldLabel']}>{t('maxTokens')}</span>
                <input
                  className={styles['input']}
                  type="text"
                  inputMode="numeric"
                  value={capacityInput('maxTokens', props.defaultMaxTokens).value}
                  placeholder={capacityInput('maxTokens', props.defaultMaxTokens).placeholder}
                  aria-label={`${t('maxTokens')} ${String(clamped + 1)}`}
                  disabled={disabled}
                  onChange={(event) => { capacityInput('maxTokens', props.defaultMaxTokens).onChange(event.target.value) }}
                  onBlur={capacityInput('maxTokens', props.defaultMaxTokens).onBlur}
                />
              </label>
            </div>
            {props.efforts === true
              ? (
                <ModelEffortChips
                  model={current}
                  position={clamped + 1}
                  disabled={disabled}
                  t={t}
                  onChange={(next) => { props.onReplaceRow(clamped, next) }}
                />
              )
              : null}
            <div className={styles['modelChipRow']} role="group" aria-label={`${t('modelInputTypes')} ${String(clamped + 1)}`}>
              {(['text', 'image'] as const).map((modality) => {
                const active = inputTypes(current, props.inputField, props.inputDefaults?.get(textOf(current, 'id')) ?? props.routeDefaultInput).includes(modality)
                return (
                  <label className={styles['modelChipToggle']} key={modality}>
                    <input
                      type="checkbox"
                      checked={active}
                      aria-label={`${t(modality === 'text' ? 'modelInputText' : 'modelInputImage')} ${String(clamped + 1)}`}
                      disabled={disabled || props.inputLoading === true}
                      onChange={(event) => {
                        const inherited = inputTypes(current, props.inputField, props.inputDefaults?.get(textOf(current, 'id')) ?? props.routeDefaultInput)
                        const next = event.target.checked
                          ? [...inherited, modality]
                          : inherited.filter(kind => kind !== modality)
                        const row: DeepSeekModelDraft = { ...current, [props.inputField]: next }
                        // DeepSeek rejects image request limits on a text-only model.
                        if (props.inputField === 'inputModalities' && !next.includes('image')) {
                          Reflect.deleteProperty(row, 'imagePixelBudget')
                          Reflect.deleteProperty(row, 'imageMaxBytes')
                        }
                        props.onReplaceRow(clamped, row)
                      }}
                    />
                    <span>{t(modality === 'text' ? 'modelInputText' : 'modelInputImage')}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
    </div>
  )
}

/** Every level a pi-ai model may declare, in the host's escalation order. */
const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One reasoning level. */
type EffortLevel = typeof EFFORT_LEVELS[number]

/** The locale key naming one level. */
const LEVEL_KEY: Readonly<Record<EffortLevel, ModelsKey>> = {
  off: 'effortOff', minimal: 'effortMinimal', low: 'effortLow', medium: 'effortMedium',
  high: 'effortHigh', xhigh: 'effortXhigh', max: 'effortMax',
}

/** Props of {@link ModelEffortChips}. */
interface ModelEffortChipsProps {
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

/**
 * Render the single-select reasoning-effort chips.
 *
 * A chip selects the level the model offers and sends the level name as its
 * wire value; clicking the selected chip again clears the field so the
 * installed catalog decides again. `reasoningEfforts: false` disables
 * reasoning outright.
 * @param props - the drafted row and its actions.
 * @returns the effort chip row.
 */
function ModelEffortChips(props: ModelEffortChipsProps): ReactNode {
  const { model, position, t, disabled } = props
  const stored = model['reasoningEfforts']
  const levels = typeof stored === 'object' && stored !== null
    ? EFFORT_LEVELS.filter(level => (stored as Record<string, unknown>)[level] !== undefined)
    : []
  const write = (next: DeepSeekModelDraft['reasoningEfforts']): void => {
    props.onChange(next === undefined
      ? Object.fromEntries(Object.entries(model).filter(([key]) => key !== 'reasoningEfforts'))
      : { ...model, reasoningEfforts: next })
  }
  return (
    <div className={styles['effortBlock']} role="group" aria-label={`${t('effortDefault')} ${String(position)}`}>
      <div className={styles['effortHead']}>
        <span className={styles['modelFieldLabel']}>{t('effortDefault')}</span>
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
      {stored === false
        ? <p className={styles['effortHint']}>{t('modelEffortsDisableHint')}</p>
        : (
          <>
            <div className={styles['modelChipRow']}>
              {EFFORT_LEVELS.map(level => (
                <button
                  type="button"
                  key={level}
                  aria-pressed={levels.includes(level)}
                  className={levels.includes(level) ? styles['modelChipActive'] : styles['modelChip']}
                  disabled={disabled}
                  onClick={() => { write(levels.includes(level) ? undefined : { [level]: level }) }}
                >
                  {t(LEVEL_KEY[level])}
                </button>
              ))}
            </div>
            <p className={styles['effortHint']}>
              {levels.length === 0 ? t('modelEffortsInherited') : t('modelEffortsHint')}
            </p>
          </>
        )}
    </div>
  )
}
