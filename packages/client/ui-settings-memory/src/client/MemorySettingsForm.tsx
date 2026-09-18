/**
 * The memory configuration form.
 *
 * The fields are declared explicitly rather than derived from the schema. The
 * plugin's schema is deeply nested with defaults at every level, and a generic
 * schema renderer would either have to guess at labels and units or show raw
 * property names; a table of the fields a user actually tunes is both smaller
 * and more honest about what each number does.
 *
 * Every write goes through the settings Remote as a path-addressed op, so the
 * value lands in the user section of `settings.yaml` and the Host re-resolves
 * the section. Clearing a field removes the user value and reverts to the
 * composition entry, which is why the "reset" affordance is an `unset` rather
 * than a write of the default.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DistillTargets, MemorySettingsFace, SettingsSnapshotView } from './MemorySection.tsx'
import type { MemoryLocaleKey } from './locales.ts'
import css from './MemorySettingsForm.module.css'

/** Props assembled by the page. */
export interface MemorySettingsFormProps {
  readonly settings: MemorySettingsFace
  /**
   * Translate one key of this page's dictionary. Passed as a function rather
   * than a bag of pre-resolved strings so the field table can name its own copy
   * by key; the page stays the only place that knows the namespace.
   */
  readonly t: (key: MemoryLocaleKey) => string
  /** Providers and their configured models, for the distillation dropdowns. */
  readonly distillTargets: DistillTargets
}

/** How a field renders and what shape it writes. */
type FieldKind = 'number' | 'boolean' | 'text' | 'select'

/** Which option list a select field draws from. */
type SelectSource = 'providers' | 'models'

/** One editable field. */
interface FieldSpec {
  /** Dotted path inside the memory settings section. */
  readonly path: readonly string[]
  /** Stable id for the input element. */
  readonly id: string
  /** Dictionary key for the field's label. */
  readonly label: MemoryLocaleKey
  /** Dictionary key for the one line explaining what the value does. */
  readonly hint: MemoryLocaleKey
  readonly kind: FieldKind
  /** For a select, which option list it offers. */
  readonly source?: SelectSource
  /** Inclusive bounds for a number field. */
  readonly min?: number
  readonly max?: number
  readonly step?: number
}

/**
 * The fields the page exposes.
 *
 * Deliberately not every key in the schema: `retrieval.useVector` is reserved
 * until an embedding service exists, and the authorization `policyVersion` is
 * an audit label rather than a preference. Showing a control that cannot change
 * behaviour would be worse than omitting it.
 *
 * Labels and hints are dictionary keys, not literals: the page is localized,
 * and an English-only form would leave a Chinese user guessing what each knob
 * does.
 */
const FIELDS: readonly FieldSpec[] = [
  { path: ['thresholds', 'excitability'], id: 'memory-excitability', label: 'field.excitability.label', hint: 'field.excitability.hint', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetDemote'], id: 'memory-forget-demote', label: 'field.forgetDemote.label', hint: 'field.forgetDemote.hint', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetArchive'], id: 'memory-forget-archive', label: 'field.forgetArchive.label', hint: 'field.forgetArchive.hint', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetHard'], id: 'memory-forget-hard', label: 'field.forgetHard.label', hint: 'field.forgetHard.hint', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['bounds', 'workingCapacity'], id: 'memory-working-capacity', label: 'field.workingCapacity.label', hint: 'field.workingCapacity.hint', kind: 'number', min: 1, step: 1 },
  { path: ['bounds', 'stagingCapacity'], id: 'memory-staging-capacity', label: 'field.stagingCapacity.label', hint: 'field.stagingCapacity.hint', kind: 'number', min: 1, step: 1 },
  { path: ['retrieval', 'topK'], id: 'memory-top-k', label: 'field.topK.label', hint: 'field.topK.hint', kind: 'number', min: 1, step: 1 },
  { path: ['retrieval', 'similarityThreshold'], id: 'memory-similarity', label: 'field.similarityThreshold.label', hint: 'field.similarityThreshold.hint', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['injection', 'hotPack'], id: 'memory-hot-pack', label: 'field.hotPack.label', hint: 'field.hotPack.hint', kind: 'boolean' },
  { path: ['injection', 'recallMaxChars'], id: 'memory-recall-chars', label: 'field.recallMaxChars.label', hint: 'field.recallMaxChars.hint', kind: 'number', min: 1, step: 100 },
  { path: ['authorization', 'enabled'], id: 'memory-authorization', label: 'field.authorization.label', hint: 'field.authorization.hint', kind: 'boolean' },
  { path: ['llmDistill', 'enabled'], id: 'memory-distill', label: 'field.distill.label', hint: 'field.distill.hint', kind: 'boolean' },
  { path: ['llmDistill', 'provider'], id: 'memory-distill-provider', label: 'field.distillProvider.label', hint: 'field.distillProvider.hint', kind: 'select', source: 'providers' },
  { path: ['llmDistill', 'model'], id: 'memory-distill-model', label: 'field.distillModel.label', hint: 'field.distillModel.hint', kind: 'select', source: 'models' },
]

/**
 * Read a dotted path out of an unknown section.
 * @param section - The resolved section, or `undefined` before the first read.
 * @param path - Path segments.
 * @returns The value at the path, or `undefined`.
 */
export function readPath(section: unknown, path: readonly string[]): unknown {
  let cursor: unknown = section
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Whether the user layer carries a value at this path.
 *
 * Drives the reset affordance: a field the user never set has nothing to clear,
 * and offering "reset" on it would be a no-op that looks like a control.
 * @param user - The user layer of the section, if the provider exposes one.
 * @param path - Path segments.
 * @returns true when the user layer holds a value there.
 */
export function userHasPath(user: unknown, path: readonly string[]): boolean {
  let cursor: unknown = user
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return false
    if (!(segment in (cursor as Record<string, unknown>))) return false
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor !== undefined
}

/**
 * Render the memory configuration form.
 * @param props - The settings face and copy.
 * @returns the form element tree.
 */
export function MemorySettingsForm(props: MemorySettingsFormProps): ReactNode {
  const { settings, t, distillTargets } = props
  const [snapshot, setSnapshot] = useState<SettingsSnapshotView>(() => settings.snapshot())
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  // The scope publishes through a snapshot store, so the form subscribes rather
  // than polling: a write from anywhere else (another tab, a file edit) has to
  // reach this form's inputs.
  useEffect(() => {
    setSnapshot(settings.snapshot())
    return settings.subscribe(() => { setSnapshot(settings.snapshot()) })
  }, [settings])

  const write = async (ops: Parameters<MemorySettingsFace['mutate']>[0]): Promise<void> => {
    setFailure(undefined)
    try {
      await settings.mutate(ops)
      setSaved(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  if (snapshot.status === 'unavailable') {
    return <p className={css.muted}>{t('settingsUnavailable')}</p>
  }

  const section = snapshot.value
  const user = snapshot.user
  const writable = snapshot.writable
  // The model list follows the provider already chosen, so the two dropdowns
  // stay consistent with what the Models page configured.
  const selectedProvider = typeof readPath(section, ['llmDistill', 'provider']) === 'string'
    ? String(readPath(section, ['llmDistill', 'provider']))
    : ''
  const optionsFor = (field: FieldSpec): readonly string[] => {
    if (field.source === 'providers') return distillTargets.providers.map(entry => entry.provider)
    const match = distillTargets.providers.find(entry => entry.provider === selectedProvider)
    return match?.models ?? []
  }
  const labelsFor = (field: FieldSpec): Record<string, string> => {
    if (field.source !== 'providers') return {}
    return Object.fromEntries(distillTargets.providers.map(entry => [entry.provider, entry.displayName]))
  }

  return (
    <div className={css.form}>
      {FIELDS.map(field => (
        <MemoryField
          key={field.id}
          field={field}
          value={readPath(section, field.path)}
          touched={userHasPath(user, field.path)}
          disabled={!writable}
          t={t}
          options={optionsFor(field)}
          optionLabels={labelsFor(field)}
          onSet={value => write([{ op: 'set', path: [...field.path], value }])}
          onClear={() => write([{ op: 'unset', path: [...field.path] }])}
        />
      ))}
      {failure !== undefined && <p className={css.error}>{t('settingsFailed')} {failure}</p>}
      {failure === undefined && saved && <p className={css.ok}>{t('settingsSaved')}</p>}
    </div>
  )
}

/**
 * The text a field's input shows for one value.
 *
 * Only scalars are editable here, so a non-scalar reads as empty rather than as
 * `[object Object]`: the section is schema-validated on the Host, and a shape
 * this form cannot render should look unset instead of looking wrong.
 * @param value - The value read from the resolved section.
 * @returns The draft text.
 */
function draftOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** One field row. */
function MemoryField(props: {
  field: FieldSpec
  value: unknown
  touched: boolean
  disabled: boolean
  t: (key: MemoryLocaleKey) => string
  /** Options a select field offers; empty for the other kinds. */
  options: readonly string[]
  /** Display text per option value, for options whose key is not their label. */
  optionLabels: Record<string, string>
  onSet: (value: unknown) => Promise<void>
  onClear: () => Promise<void>
}): ReactNode {
  const { field, value, touched, disabled, t, options, optionLabels, onSet, onClear } = props
  // The draft is local until it parses: typing "0." into a number input must
  // not write 0 on the way to "0.5".
  const [draft, setDraft] = useState<string>(() => draftOf(value))

  useEffect(() => {
    setDraft(draftOf(value))
  }, [value])

  const commitNumber = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') {
      void onClear()
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return
    if (field.min !== undefined && parsed < field.min) return
    if (field.max !== undefined && parsed > field.max) return
    void onSet(parsed)
  }

  // A select with nothing to offer cannot be satisfied from the list, so it is
  // disabled and the hint explains where the options come from. The stored
  // value stays visible as its own option when it is not in the list, so an
  // existing configuration is never silently blanked.
  const current = draftOf(value)
  const hasCurrent = current !== ''
  const listed = options.includes(current)
  const empty = options.length === 0
  const selectDisabled = disabled || empty

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <label className={css.label} htmlFor={field.id}>{t(field.label)}</label>
        <span className={css.hint}>
          {t(field.hint)}
          {field.kind === 'select' && empty && ` ${t('settingsNoModels')}`}
        </span>
      </div>
      <div className={css.rowControl}>
        {field.kind === 'boolean'
          ? (
            <input
              id={field.id}
              type="checkbox"
              className={css.checkbox}
              checked={value === true}
              disabled={disabled}
              onChange={(event) => { void onSet(event.target.checked) }}
            />
          )
          : field.kind === 'select'
            ? (
              <select
                id={field.id}
                className={css.input}
                value={current}
                disabled={selectDisabled}
                onChange={(event) => {
                  const next = event.target.value
                  if (next === '') void onClear()
                  else void onSet(next)
                }}
              >
                {/* An empty choice is the composition default, so it is always
                    offered unless the list itself is empty. */}
                {!empty && <option value="">{t('settingsUnset')}</option>}
                {hasCurrent && !listed && <option value={current}>{current}</option>}
                {options.map(option => (
                  <option key={option} value={option}>{optionLabels[option] ?? option}</option>
                ))}
              </select>
            )
            : (
              <input
                id={field.id}
                className={css.input}
                type={field.kind === 'number' ? 'number' : 'text'}
                value={draft}
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={disabled}
                onChange={(event) => { setDraft(event.target.value) }}
                onBlur={(event) => {
                  if (field.kind === 'number') commitNumber(event.target.value)
                  else void (event.target.value.trim() === '' ? onClear() : onSet(event.target.value.trim()))
                }}
              />
            )}
        {touched && (
          <Button onClick={() => { void onClear() }} disabled={disabled}>{t('settingsReset')}</Button>
        )}
      </div>
    </div>
  )
}
