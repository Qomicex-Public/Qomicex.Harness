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
import type { MemorySettingsFace, SettingsSnapshotView } from './MemorySection.tsx'
import css from './MemorySettingsForm.module.css'

/** The copy the form needs. */
export interface MemorySettingsFormLabels {
  readonly reset: string
  readonly saved: string
  readonly failed: string
  /** Shown when the Host exposes no writable section for this namespace. */
  readonly unavailable: string
}

/** Props assembled by the page. */
export interface MemorySettingsFormProps {
  readonly settings: MemorySettingsFace
  readonly labels: MemorySettingsFormLabels
}

/** How a field renders and what shape it writes. */
type FieldKind = 'number' | 'boolean' | 'text'

/** One editable field. */
interface FieldSpec {
  /** Dotted path inside the memory settings section. */
  readonly path: readonly string[]
  /** Stable id for the input element. */
  readonly id: string
  readonly label: string
  /** One line explaining what the value does. */
  readonly hint: string
  readonly kind: FieldKind
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
 */
const FIELDS: readonly FieldSpec[] = [
  { path: ['thresholds', 'excitability'], id: 'memory-excitability', label: 'Excitability threshold', hint: 'Minimum novelty/confirmation score for a candidate to be written.', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetDemote'], id: 'memory-forget-demote', label: 'Demote above', hint: 'Forget score above which a memory is demoted.', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetArchive'], id: 'memory-forget-archive', label: 'Archive above', hint: 'Forget score above which a memory is archived.', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['thresholds', 'forgetHard'], id: 'memory-forget-hard', label: 'Hard-forget above', hint: 'Forget score above which a memory is hard-forgotten.', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['bounds', 'workingCapacity'], id: 'memory-working-capacity', label: 'Working memory slots', hint: 'How many memories stay immediately available.', kind: 'number', min: 1, step: 1 },
  { path: ['bounds', 'stagingCapacity'], id: 'memory-staging-capacity', label: 'Staging capacity', hint: 'Staged candidates retained per session.', kind: 'number', min: 1, step: 1 },
  { path: ['retrieval', 'topK'], id: 'memory-top-k', label: 'Recall top K', hint: 'Maximum hits returned by one recall.', kind: 'number', min: 1, step: 1 },
  { path: ['retrieval', 'similarityThreshold'], id: 'memory-similarity', label: 'Similarity threshold', hint: 'Minimum relevance for a hit to survive.', kind: 'number', min: 0, max: 1, step: 0.05 },
  { path: ['injection', 'hotPack'], id: 'memory-hot-pack', label: 'Inject hot pack', hint: 'Inject the hot pack at the first step of a turn.', kind: 'boolean' },
  { path: ['injection', 'recallMaxChars'], id: 'memory-recall-chars', label: 'Recall block limit', hint: 'Maximum characters of one injected recall block.', kind: 'number', min: 1, step: 100 },
  { path: ['authorization', 'enabled'], id: 'memory-authorization', label: 'Authorization plane', hint: 'Gate tool calls through the six-tuple policy plane.', kind: 'boolean' },
  { path: ['llmDistill', 'enabled'], id: 'memory-distill', label: 'LLM distillation', hint: 'Let consolidation call the model to distill facts.', kind: 'boolean' },
  { path: ['llmDistill', 'provider'], id: 'memory-distill-provider', label: 'Distill provider', hint: 'Provider route for distillation; empty disables the path.', kind: 'text' },
  { path: ['llmDistill', 'model'], id: 'memory-distill-model', label: 'Distill model', hint: 'Model id for distillation; empty disables the path.', kind: 'text' },
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
  const { settings, labels } = props
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
    return <p className={css.muted}>{labels.unavailable}</p>
  }

  const section = snapshot.value
  const user = snapshot.user
  const writable = snapshot.writable

  return (
    <div className={css.form}>
      {FIELDS.map(field => (
        <MemoryField
          key={field.id}
          field={field}
          value={readPath(section, field.path)}
          touched={userHasPath(user, field.path)}
          disabled={!writable}
          labels={labels}
          onSet={value => write([{ op: 'set', path: [...field.path], value }])}
          onClear={() => write([{ op: 'unset', path: [...field.path] }])}
        />
      ))}
      {failure !== undefined && <p className={css.error}>{labels.failed} {failure}</p>}
      {failure === undefined && saved && <p className={css.ok}>{labels.saved}</p>}
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
function MemoryField(props: {  field: FieldSpec
  value: unknown
  touched: boolean
  disabled: boolean
  labels: MemorySettingsFormLabels
  onSet: (value: unknown) => Promise<void>
  onClear: () => Promise<void>
}): ReactNode {
  const { field, value, touched, disabled, labels, onSet, onClear } = props
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

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <label className={css.label} htmlFor={field.id}>{field.label}</label>
        <span className={css.hint}>{field.hint}</span>
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
          <Button onClick={() => { void onClear() }} disabled={disabled}>{labels.reset}</Button>
        )}
      </div>
    </div>
  )
}
