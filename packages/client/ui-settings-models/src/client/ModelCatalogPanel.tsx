/**
 * Compact model catalog panel shared by both adapter editors.
 *
 * The reference design replaces the per-row disclosure with one panel: models
 * are tiles (name, capacity summary, remove), the selected tile's settings sit
 * inline below, capacities offer a preset segment track above the exact number
 * input, and reasoning effort pairs an offered-level multi-select track with a
 * default-level dropdown. Every option group speaks the app's
 * segmented-control language — one rounded-rectangle track holding its options
 * side by side, the chosen segment raised on the layer-1 surface. A newly
 * offered effort level sends the level name as its wire value and a kept level
 * keeps its stored spelling — the page exposes no per-level wire editing, so a
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
                className={index === clamped ? `${styles['modelChip']} ${styles['modelChipActive']}` : styles['modelChip']}
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
            <CapacityGroup
              title={t('contextWindow')}
              presets={CONTEXT_PRESETS}
              value={numberOf(current, 'contextWindow')}
              position={clamped + 1}
              input={capacityInput('contextWindow', props.defaultContextWindow)}
              disabled={disabled}
              onPick={(preset) => { props.onPatchRow(clamped, { contextWindow: preset }) }}
            />
            <CapacityGroup
              title={t('maxTokens')}
              presets={MAX_PRESETS}
              value={numberOf(current, 'maxTokens')}
              position={clamped + 1}
              input={capacityInput('maxTokens', props.defaultMaxTokens)}
              disabled={disabled}
              onPick={(preset) => { props.onPatchRow(clamped, { maxTokens: preset }) }}
            />
            {props.efforts === true
              ? (
                <ModelEffortEditor
                  model={current}
                  position={clamped + 1}
                  disabled={disabled}
                  t={t}
                  onChange={(next) => { props.onReplaceRow(clamped, next) }}
                />
              )
              : null}
            <div className={styles['modelGroup']} role="group" aria-label={`${t('modelInputTypes')} ${String(clamped + 1)}`}>
              <div className={styles['modelGroupTitle']}>{t('modelInputTypes')}</div>
              <div className={styles['segmentTrack']}>
                {(['text', 'image'] as const).map((modality) => {
                  const active = inputTypes(current, props.inputField, props.inputDefaults?.get(textOf(current, 'id')) ?? props.routeDefaultInput).includes(modality)
                  return (
                    <label className={styles['segmentToggle']} key={modality}>
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
          </div>
        )}
    </div>
  )
}

/**
 * Render one labeled capacity block: title, preset chips, exact value input.
 *
 * The group follows the Appearance-row pattern (ui-theme) — a visible title
 * above the chips — so the capacity presets read as settings rather than bare
 * numbers. The exact input accepts any value the presets do not list.
 * @param props - the field's title, presets, stored value and edit surface.
 * @returns the labeled capacity group.
 */
function CapacityGroup(props: CapacityGroupProps): ReactNode {
  const { title, presets, value, position, input, disabled } = props
  return (
    <div className={styles['modelGroup']}>
      <div className={styles['modelGroupTitle']}>{title}</div>
      <div className={styles['segmentTrack']} role="group" aria-label={title}>
        {presets.map(preset => (
          <button
            type="button"
            key={preset}
            aria-pressed={value === preset}
            className={styles['segment']}
            disabled={disabled}
            onClick={() => { props.onPick(preset) }}
          >
            {formatCapacity(preset)}
          </button>
        ))}
      </div>
      <input
        className={styles['input']}
        type="text"
        inputMode="numeric"
        value={input.value}
        placeholder={input.placeholder}
        aria-label={`${title} ${String(position)}`}
        disabled={disabled}
        onChange={(event) => { input.onChange(event.target.value) }}
        onBlur={input.onBlur}
      />
    </div>
  )
}

/** Props of {@link CapacityGroup}. */
interface CapacityGroupProps {
  /** Group title, also the exact input's accessible-name stem. */
  title: string
  /** Presets in escalation order. */
  presets: readonly number[]
  /** The row's stored count; undefined leaves the chips unselected. */
  value: number | undefined
  /** Row position in the list, for accessible names. */
  position: number
  /** The exact value's editable text surface. */
  input: CapacityInput
  /** Disable every mutation. */
  disabled: boolean
  /** Apply one preset for this field. */
  onPick: (preset: number) => void
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

/** Props of {@link ModelEffortEditor}. */
interface ModelEffortEditorProps {
  /** The drafted model row; the effort fields are edited here. */
  model: DeepSeekModelDraft
  /** Row position in the list, for accessible names. */
  position: number
  /** Disable writes (read-only settings provider). */
  disabled: boolean
  t: (key: ModelsKey) => string
  /** Receive the row with its effort fields rewritten. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * Render the reasoning-effort editor: an offered-level multi-select track and
 * a default-level dropdown.
 *
 * The offered levels are the `reasoningEfforts` keys; a newly offered level
 * sends the level name as its wire spelling and a kept level keeps the
 * spelling the row already carries, so the page exposes no per-level wire
 * editing and a gateway's rename survives an edit. An offered set with no
 * level beyond `off` cannot reason, so it is written as `false`, the host
 * schema's non-reasoning declaration. The default level rides
 * `defaultReasoningEffort` and only ever names an offered level: unchecking
 * the defaulted level clears it, because the host drops a default the model
 * does not offer.
 * @param props - the drafted row and its actions.
 * @returns the effort editor.
 */
function ModelEffortEditor(props: ModelEffortEditorProps): ReactNode {
  const { model, position, t, disabled } = props
  const stored = model['reasoningEfforts']
  const offered = stored === false || typeof stored !== 'object' || stored === null
    ? []
    : EFFORT_LEVELS.filter(level => (stored as Record<string, unknown>)[level] !== undefined)
  const storedDefault = model['defaultReasoningEffort']
  const defaultLevel = typeof storedDefault === 'string' && offered.includes(storedDefault as EffortLevel)
    ? storedDefault as EffortLevel
    : undefined
  /** The stored `reasoningEfforts` shapes this editor can write. */
  type EffortsValue = false | Record<string, unknown>
  /** Rewrite both effort fields, dropping whichever this edit leaves unset. */
  const write = (efforts: EffortsValue, nextDefault: EffortLevel | undefined): void => {
    props.onChange({
      ...Object.fromEntries(Object.entries(model).filter(([key]) =>
        key !== 'reasoningEfforts' && key !== 'defaultReasoningEffort')),
      reasoningEfforts: efforts,
      ...nextDefault === undefined ? {} : { defaultReasoningEffort: nextDefault },
    })
  }
  const toggle = (level: EffortLevel, next: boolean): void => {
    // A kept level keeps the wire spelling the row already carries, so an edit
    // never rewrites a gateway's rename; a newly offered level sends the level
    // name, which is all this page exposes.
    const storedRecord = typeof stored === 'object' && stored !== null
      ? stored as Record<string, unknown>
      : {}
    const levels = EFFORT_LEVELS.filter(candidate => candidate === level ? next : offered.includes(candidate))
    const efforts: EffortsValue = levels.some(candidate => candidate !== 'off')
      ? Object.fromEntries(levels.map(candidate => [
        candidate,
        offered.includes(candidate) ? storedRecord[candidate] : candidate,
      ]))
      : false
    write(efforts, efforts !== false && defaultLevel !== undefined && levels.includes(defaultLevel)
      ? defaultLevel
      : undefined)
  }
  const hint = stored === false
    ? t('modelEffortsDisableHint')
    : stored === undefined
      ? t('modelEffortsInherited')
      : defaultLevel === undefined ? t('effortDefaultInherited') : t('modelEffortsHint')
  return (
    <div className={styles['effortBlock']}>
      <div className={styles['modelGroupTitle']}>{t('modelEfforts')}</div>
      <div className={styles['segmentTrack']} role="group" aria-label={`${t('modelEfforts')} ${String(position)}`}>
        {EFFORT_LEVELS.map(level => (
          <label className={styles['segmentToggle']} key={level}>
            <input
              type="checkbox"
              checked={offered.includes(level)}
              aria-label={`${t(LEVEL_KEY[level])} ${String(position)}`}
              disabled={disabled}
              onChange={(event) => { toggle(level, event.target.checked) }}
            />
            <span>{t(LEVEL_KEY[level])}</span>
          </label>
        ))}
      </div>
      <div className={styles['effortDefaultRow']}>
        <span className={styles['modelGroupTitle']}>{t('effortDefault')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={defaultLevel ?? ''}
          disabled={disabled || offered.length === 0}
          aria-label={`${t('effortDefault')} ${String(position)}`}
          onChange={(event) => {
            // Only offered levels reach the dropdown, so `stored` is a record
            // whenever this handler can fire.
            write(stored as EffortsValue, event.target.value === '' ? undefined : event.target.value as EffortLevel)
          }}
        >
          <option value="">{t('effortInherit')}</option>
          {offered.map(level => <option key={level} value={level}>{t(LEVEL_KEY[level])}</option>)}
        </select>
      </div>
      <p className={styles['effortHint']}>{hint}</p>
    </div>
  )
}
