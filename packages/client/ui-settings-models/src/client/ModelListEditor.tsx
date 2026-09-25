/**
 * The model catalog of one pi-ai provider profile, plus the action that asks
 * the provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a model is only ever added deliberately. Fetching asks the
 * endpoint **the form currently shows** — including a key typed but not yet
 * saved — so adding a provider is one pass instead of save-then-return; the
 * reply is candidates the user picks from, never configuration written behind
 * them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * chips the user can still fill in by hand.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsOperations } from './operations.ts'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { en } from './locales.ts'
import { ModelCatalogPanel } from './ModelCatalogPanel.tsx'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Fields this card does not edit must survive an
 * edit rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Installed provider whose catalog supplies defaults without endpoint I/O. */
  catalogProvider?: string | undefined
  /** Route input types for models absent from the installed catalog. */
  defaultInput?: readonly string[] | undefined
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** The Host operations whose interrogation answers the fetch action. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
  /**
   * Called once per change with whether an endpoint interrogation is in
   * flight. The owning card folds it into its own busy state so the surface
   * around the card — a mode switch, say — can refuse to move while the
   * answer, and the picker it opens, is still bound for this list.
   */
  onBusyChange: (busy: boolean) => void
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled, onBusyChange } = props
  const { catalogProvider } = props
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [inheritedCatalog, setInheritedCatalog] = useState<{
    provider: string
    models: readonly LlmDiscoveredModel[]
  } | undefined>(undefined)
  useEffect(() => {
    if (catalogProvider === undefined) return
    let current = true
    void operations.discoverModels(probe.settingsNs, { provider: catalogProvider }).then((answer) => {
      if (!current) return
      setInheritedCatalog({ provider: catalogProvider, models: answer.kind === 'found' ? answer.models : [] })
      setFailure(answer.kind === 'refused' ? answer.message : undefined)
    })
    return () => { current = false }
  }, [catalogProvider, operations, probe.settingsNs])
  const catalog = inheritedCatalog?.provider === catalogProvider ? inheritedCatalog?.models : undefined
  const inputDefaults = useMemo(() => {
    const defaults = new Map<string, readonly string[]>()
    for (const model of catalog ?? []) {
      defaults.set(model.id, model.inputModalities as readonly string[])
    }
    return defaults
  }, [catalog])
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [candidateQuery, setCandidateQuery] = useState('')
  const [newId, setNewId] = useState('')
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)

  /** Apply one row's patch; an emptied optional field leaves the profile. */
  const patch = (index: number, next: Record<string, string | number | undefined>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      const found = answer.models
      if (catalogProvider !== undefined) setInheritedCatalog({ provider: catalogProvider, models: found })
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidateQuery('')
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
    setCandidateQuery('')
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // whose id is still empty has no identity to preserve.
      const existing = byId.get(candidate.id)
      if (existing !== undefined) continue
      byId.set(candidate.id, {
        id: candidate.id,
        ...candidate.name === undefined ? {} : { name: candidate.name },
        ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
        ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
        ...candidate.inputModalities === undefined ? {} : { input: [...candidate.inputModalities] },
      })
    }
    onChange([...byId.values()])
    closePicker()
  }

  const candidateNeedle = candidateQuery.trim().toLowerCase()
  const visibleCandidates = (candidates ?? []).filter(candidate =>
    candidateNeedle.length === 0
    || candidate.id.toLowerCase().includes(candidateNeedle)
    || candidate.name?.toLowerCase().includes(candidateNeedle) === true)
  const allVisibleCandidatesPicked = visibleCandidates.length > 0
    && visibleCandidates.every(candidate => picked.has(candidate.id))
  const toggleVisibleCandidates = (): void => {
    setPicked((current) => {
      // Deselecting clears every selection, not just the visible ones: a
      // hidden pick can never be adopted accidentally.
      if (visibleCandidates.length > 0 && visibleCandidates.every(candidate => current.has(candidate.id))) {
        return new Set()
      }
      const next = new Set(current)
      for (const candidate of visibleCandidates) next.add(candidate.id)
      return next
    })
  }

  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {props.overridden === true ? t('modelsCustomized') : t('modelsInherited')}
          </span>
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
      </div>
      <ModelCatalogPanel
        models={models}
        disabled={disabled}
        inputField="input"
        inputDefaults={inputDefaults}
        routeDefaultInput={props.defaultInput}
        inputLoading={catalogProvider !== undefined && catalog === undefined}
        efforts
        t={t}
        onPatchRow={patch}
        onReplaceRow={(index, row) => { onChange(models.map((model, at) => at === index ? row : model)) }}
        onRemoveRow={(index) => { onChange(models.filter((_model, at) => at !== index)) }}
      />
      <div className={styles['modelAddRow']}>
        <input
          className={styles['input']}
          type="text"
          value={newId}
          placeholder={t('modelAddPlaceholder')}
          aria-label={t('modelAdd')}
          disabled={disabled}
          onChange={(event) => { setNewId(event.target.value) }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || newId.trim().length === 0}
          onClick={() => {
            const id = newId.trim()
            /* v8 ignore next -- the add button is disabled while the field is empty */
            if (id.length === 0) return
            onChange([...models.map(model => ({ ...model })), { id }])
            setNewId('')
          }}
        >
          {t('addCustomModel')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </Button>
      </div>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles['candidateToolbar']}>
          <input
            className={`${styles['input']} ${styles['candidateSearch']}`}
            type="search"
            value={candidateQuery}
            placeholder={t('fetchSearch')}
            aria-label={t('fetchSearch')}
            onChange={(event) => { setCandidateQuery(event.target.value) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={visibleCandidates.length === 0}
            onClick={toggleVisibleCandidates}
          >
            {t(allVisibleCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        {visibleCandidates.length === 0
          ? <p className={styles['candidateEmpty']} role="status">{t('fetchNoMatches')}</p>
          : (
            <ul className={styles['candidateList']}>
              {visibleCandidates.map(candidate => (
                <li key={candidate.id} className={styles['candidate']}>
                  <label className={styles['candidateLabel']}>
                    <input
                      type="checkbox"
                      checked={picked.has(candidate.id)}
                      onChange={() => {
                        setPicked((current) => {
                          const next = new Set(current)
                          if (!next.delete(candidate.id)) next.add(candidate.id)
                          return next
                        })
                      }}
                    />
                    <span className={styles['candidateId']} title={candidate.name ?? candidate.id}>
                      {candidate.id}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
      </Modal>
    </section>
  )
}
