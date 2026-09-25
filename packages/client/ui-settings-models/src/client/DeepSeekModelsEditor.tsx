/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import { ModelCatalogPanel } from './ModelCatalogPanel.tsx'
import styles from './ModelsSection.module.css'

/** One catalog entry kept structurally open so hidden or future fields survive an edit. */
export type DeepSeekModelDraft = Record<string, unknown>

/** The catalog fields this editor writes. */
type CatalogField = 'id' | 'name' | 'contextWindow' | 'maxTokens'

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
 * (rejected by {@link validateDeepSeekModels} before any write).
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** A localized validation failure for one user-owned model array. */
export interface DeepSeekModelsValidationFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid' | 'modelEffortWireRequired' | 'modelEffortDefaultInvalid'
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): DeepSeekModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as DeepSeekModelDraft
      : {})
}

/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
export function validateDeepSeekModels(value: unknown): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    // Compared trimmed: surrounding whitespace is a paste artifact the adapter
    // would never match, and an untrimmed compare lets `model ` slip past the
    // duplicate check against its own twin.
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
    // Every declared level above `off` must carry the wire value dispatch
    // sends; the host refuses the empty spelling, so the page refuses first.
    const efforts = model['reasoningEfforts']
    if (typeof efforts === 'object' && efforts !== null
      && Object.entries(efforts as Record<string, unknown>).some(
        ([level, wire]) => level !== 'off' && (typeof wire !== 'string' || wire.length === 0),
      )) {
      return { index, key: 'modelEffortWireRequired' }
    }
    // The default level is a level name, nothing more: the host drops one the
    // model does not offer, so an unknown spelling is a type question, not a
    // reachable disagreement worth a second diagnostic.
    const defaultEffort = model['defaultReasoningEffort']
    if (defaultEffort !== undefined && (typeof defaultEffort !== 'string' || defaultEffort.length === 0)) {
      return { index, key: 'modelEffortDefaultInvalid' }
    }
  }
  return undefined
}

/** Props of {@link DeepSeekModelsEditor}. */
export interface DeepSeekModelsEditorProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden: boolean
  /** Fallback context capacity used when a row omits its exact value. */
  defaultContextWindow: number | undefined
  /** Fallback output cap used when a row omits its exact value. */
  defaultMaxTokens: number | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every mutation. */
  disabled: boolean
  /** Replace the user-owned array after one visible edit. */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance. */
  onReset: () => void
}

/**
 * Render the direct DeepSeek adapter's model catalog as the compact panel
 * shared with the pi-ai editor.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor.
 */
export function DeepSeekModelsEditor(props: DeepSeekModelsEditorProps): ReactNode {
  const [newId, setNewId] = useState('')

  const update = (index: number, key: CatalogField, value: unknown): void => {
    props.onChange(props.models.map((model, at) => {
      const copy = { ...model }
      if (at !== index) return copy
      if (value === undefined) Reflect.deleteProperty(copy, key)
      else copy[key] = value
      return copy
    }))
  }

  const remove = (index: number): void => {
    props.onChange(props.models.filter((_model, at) => at !== index).map(model => ({ ...model })))
  }

  return (
    <section className={styles['modelCatalog']} aria-label={props.t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{props.t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited')}
          </span>
        </div>
        {props.overridden
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={props.disabled}
              onClick={props.onReset}
            >
              {props.t('resetModels')}
            </button>
          )
          : null}
      </div>
      <ModelCatalogPanel
        models={props.models}
        disabled={props.disabled}
        inputField="inputModalities"
        defaultContextWindow={props.defaultContextWindow}
        defaultMaxTokens={props.defaultMaxTokens}
        t={props.t}
        onPatchRow={(index, patch) => {
          for (const [key, value] of Object.entries(patch)) update(index, key as CatalogField, value)
        }}
        onReplaceRow={(index, row) => {
          props.onChange(props.models.map((model, at) => at === index ? row : model))
        }}
        onRemoveRow={remove}
      />
      <div className={styles['modelAddRow']}>
        <input
          className={styles['input']}
          type="text"
          value={newId}
          placeholder={props.t('modelAddPlaceholder')}
          aria-label={props.t('modelAdd')}
          disabled={props.disabled}
          onChange={(event) => { setNewId(event.target.value) }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={props.disabled || newId.trim().length === 0}
          onClick={() => {
            const id = newId.trim()
            /* v8 ignore next -- the add button is disabled while the field is empty */
            if (id.length === 0) return
            props.onChange([...props.models.map(model => ({ ...model })), { id }])
            setNewId('')
          }}
        >
          {props.t('addCustomModel')}
        </Button>
      </div>
    </section>
  )
}
