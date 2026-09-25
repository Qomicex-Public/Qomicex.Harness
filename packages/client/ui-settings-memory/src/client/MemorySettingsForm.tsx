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

/** Progress of the judge-model download, as the Settings page shows it. */
interface DownloadView {
  readonly status: 'idle' | 'downloading' | 'done' | 'failed'
  readonly receivedBytes: number
  readonly totalBytes: number
  readonly path: string
  readonly error?: string
}

/** Read a download state out of whatever the Remote returned. */
function downloadViewOf(value: unknown): DownloadView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const status = record.status
  if (status !== 'idle' && status !== 'downloading' && status !== 'done' && status !== 'failed') {
    return undefined
  }
  return {
    status,
    receivedBytes: typeof record.receivedBytes === 'number' ? record.receivedBytes : 0,
    totalBytes: typeof record.totalBytes === 'number' ? record.totalBytes : 0,
    path: typeof record.path === 'string' ? record.path : '',
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  }
}

/** One progress figure, in the unit a human reads. */
function formatBytes(bytes: number, t: (key: MemoryLocaleKey) => string): string {
  if (bytes <= 0) return t('bytesZero')
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Props assembled by the page. */
export interface MemorySettingsFormProps {
  readonly settings: MemorySettingsFace
  /**
   * Translate one key of this page's dictionary, with optional `{name}`
   * template params. Passed as a function rather than a bag of pre-resolved
   * strings so the field table can name its own copy by key; the page stays
   * the only place that knows the namespace.
   */
  readonly t: (key: MemoryLocaleKey, params?: Record<string, unknown>) => string
  /** Providers and their configured models, for the distillation dropdowns. */
  readonly distillTargets: DistillTargets
  /**
   * Fetch the judge model into the configured path. Resolves as soon as the
   * download has been *started*; watch `modelDownloadStatus` for progress.
   * Absent when the memory Remote namespace is not reachable, which is the
   * same deployment that leaves the graph empty.
   */
  readonly downloadModel?: (() => Promise<unknown>) | undefined
  /** Poll the download's progress, or its absence. */
  readonly modelDownloadStatus?: (() => Promise<unknown>) | undefined
  /** Reveal the model file in the platform's file manager. */
  readonly revealModelFile?: (() => Promise<unknown>) | undefined
  /** List the extracted patterns, for the Settings panel. */
  readonly patterns?: (() => Promise<unknown>) | undefined
  /** Run one pattern-extraction pass now. */
  readonly extractPatternsNow?: (() => Promise<unknown>) | undefined
  /** Approve, reject, disable, or re-enable one pattern. */
  readonly decidePattern?: ((
    patternId: string,
    action: 'approve' | 'reject' | 'disable' | 'enable',
  ) => Promise<unknown>) | undefined
}

/** One pattern row as the panel shows it. */
interface PatternRow {
  readonly id: string
  readonly kind: string
  readonly content: string
  readonly confidence: number
  readonly state: string
  readonly occurrenceCount: number
  readonly projectCount: number
}

/** Read the pattern list out of whatever the Remote returned. */
function patternRowsOf(value: unknown): PatternRow[] {
  if (!Array.isArray(value)) return []
  const rows: PatternRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.content !== 'string') continue
    rows.push({
      id: record.id,
      kind: typeof record.kind === 'string' ? record.kind : '',
      content: record.content,
      confidence: typeof record.confidence === 'number' ? record.confidence : 0,
      state: typeof record.state === 'string' ? record.state : '',
      occurrenceCount: typeof record.occurrenceCount === 'number' ? record.occurrenceCount : 0,
      projectCount: typeof record.projectCount === 'number' ? record.projectCount : 0,
    })
  }
  return rows
}

/** How a field renders and what shape it writes. */
type FieldKind = 'number' | 'boolean' | 'text' | 'select'

/** Which option list a select field draws from. */
type SelectSource = 'providers' | 'models'

/**
 * Enum options a select offers when the list is not discovered.
 *
 * These are the closed sets the schema itself declares, so a wrong option here
 * is a compile-time-visible mismatch rather than a value the Host would reject
 * at runtime. Their display names come from the dictionary.
 */
const ENUM_OPTIONS = {
  ruleEngineMode: ['relaxed', 'strict'],
  schedule: ['daily', 'weekly', 'monthly'],
  toolkitEnabled: ['auto', 'on', 'off'],
} as const

/** Dictionary keys naming each enum option, so a select shows prose. */
const ENUM_LABELS: Record<string, MemoryLocaleKey> = {
  relaxed: 'option.relaxed',
  strict: 'option.strict',
  daily: 'option.daily',
  weekly: 'option.weekly',
  monthly: 'option.monthly',
  auto: 'option.auto',
  on: 'option.on',
  off: 'option.off',
}

/** The sections the form is grouped into, in display order. */
export type FieldGroup =
  | 'master'
  | 'basic'
  | 'judgment'
  | 'retention'
  | 'patternExtraction'
  | 'patternApplication'
  | 'curation'
  | 'integrations'
  | 'retrieval'
  | 'authorization'

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
  /** For a select over a closed set, which set it offers. */
  readonly options?: readonly string[]
  /** Inclusive bounds for a number field. */
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /** The section this field belongs to. */
  readonly group: FieldGroup
  /** Rendered as an action row rather than an editable field. */
  readonly hidden?: boolean
}

/** The sections in display order, each with its heading key. */
const GROUP_ORDER: readonly { group: FieldGroup; title: MemoryLocaleKey; hint: MemoryLocaleKey }[] = [
  { group: 'master', title: 'group.master', hint: 'group.master.hint' },
  { group: 'judgment', title: 'group.judgment', hint: 'group.judgment.hint' },
  { group: 'retention', title: 'group.retention', hint: 'group.retention.hint' },
  { group: 'patternExtraction', title: 'group.patternExtraction', hint: 'group.patternExtraction.hint' },
  { group: 'patternApplication', title: 'group.patternApplication', hint: 'group.patternApplication.hint' },
  { group: 'curation', title: 'group.curation', hint: 'group.curation.hint' },
  { group: 'integrations', title: 'group.integrations', hint: 'group.integrations.hint' },
  { group: 'retrieval', title: 'group.retrieval', hint: 'group.retrieval.hint' },
  { group: 'basic', title: 'group.basic', hint: 'group.basic.hint' },
  { group: 'authorization', title: 'group.authorization', hint: 'group.authorization.hint' },
]

/**
 * The fields the page exposes.
 *
 * Deliberately not every key in the schema. A few are withheld because showing
 * a control that cannot change behaviour would be worse than omitting it:
 * `retrieval.useVector` is reserved until an embedding service exists, the
 * authorization `policyVersion` is an audit label rather than a preference, and
 * the local model's `modelVersion` and `promptVersion` are stamped onto
 * judgment rows for a trainer rather than tuned by a user.
 *
 * Labels and hints are dictionary keys, not literals: the page is localized,
 * and an English-only form would leave a Chinese user guessing what each knob
 * does.
 *
 * The sections follow the design document's layout, and the layers are ordered
 * along the write path: what gets in, how long it stays, what repeats, what
 * that changes, and what tidies up afterwards.
 */
const FIELDS: readonly FieldSpec[] = [
  { path: ['enabled'], id: 'memory-enabled', label: 'field.enabled.label', hint: 'field.enabled.hint', kind: 'boolean', group: 'master' },
  { path: ['judgment', 'ruleEngine', 'mode'], id: 'memory-rule-engine-mode', label: 'field.ruleEngineMode.label', hint: 'field.ruleEngineMode.hint', kind: 'select', options: ENUM_OPTIONS.ruleEngineMode, group: 'basic' },
  { path: ['thresholds', 'excitability'], id: 'memory-excitability', label: 'field.excitability.label', hint: 'field.excitability.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'basic' },
  { path: ['thresholds', 'forgetDemote'], id: 'memory-forget-demote', label: 'field.forgetDemote.label', hint: 'field.forgetDemote.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'basic' },
  { path: ['thresholds', 'forgetArchive'], id: 'memory-forget-archive', label: 'field.forgetArchive.label', hint: 'field.forgetArchive.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'basic' },
  { path: ['thresholds', 'forgetHard'], id: 'memory-forget-hard', label: 'field.forgetHard.label', hint: 'field.forgetHard.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'basic' },
  { path: ['judgment', 'localLlm', 'enabled'], id: 'memory-local-llm-enabled', label: 'field.localLlmEnabled.label', hint: 'field.localLlmEnabled.hint', kind: 'boolean', group: 'judgment' },
  { path: ['judgment', 'localLlm', 'modelPath'], id: 'memory-local-llm-model-path', label: 'field.localLlmModelPath.label', hint: 'field.localLlmModelPath.hint', kind: 'text', group: 'judgment' },  { path: ['judgment', 'localLlm', 'gpuLayers'], id: 'memory-local-llm-gpu-layers', label: 'field.localLlmGpuLayers.label', hint: 'field.localLlmGpuLayers.hint', kind: 'number', min: 0, step: 1, group: 'judgment' },
  { path: ['judgment', 'localLlm', 'contextSize'], id: 'memory-local-llm-context-size', label: 'field.localLlmContextSize.label', hint: 'field.localLlmContextSize.hint', kind: 'number', min: 256, step: 256, group: 'judgment' },
  { path: ['retention', 'initialTTLDays'], id: 'memory-initial-ttl', label: 'field.initialTTLDays.label', hint: 'field.initialTTLDays.hint', kind: 'number', min: 1, step: 1, group: 'retention' },
  { path: ['retention', 'promotionThreshold'], id: 'memory-promotion-threshold', label: 'field.promotionThreshold.label', hint: 'field.promotionThreshold.hint', kind: 'number', min: 0, step: 0.5, group: 'retention' },
  { path: ['retention', 'startupGraceSessions'], id: 'memory-startup-grace', label: 'field.startupGraceSessions.label', hint: 'field.startupGraceSessions.hint', kind: 'number', min: 0, step: 1, group: 'retention' },
  { path: ['retention', 'archiveOnExpiry'], id: 'memory-archive-on-expiry', label: 'field.archiveOnExpiry.label', hint: 'field.archiveOnExpiry.hint', kind: 'boolean', group: 'retention' },
  { path: ['retention', 'structuralException'], id: 'memory-structural-exception', label: 'field.structuralException.label', hint: 'field.structuralException.hint', kind: 'boolean', group: 'retention' },
  { path: ['patternExtraction', 'enabled'], id: 'memory-pattern-enabled', label: 'field.patternEnabled.label', hint: 'field.patternEnabled.hint', kind: 'boolean', group: 'patternExtraction' },
  { path: ['patternExtraction', 'schedule'], id: 'memory-pattern-schedule', label: 'field.patternSchedule.label', hint: 'field.patternSchedule.hint', kind: 'select', options: ENUM_OPTIONS.schedule, group: 'patternExtraction' },
  { path: ['patternExtraction', 'requireHumanApproval'], id: 'memory-pattern-approval', label: 'field.patternRequireApproval.label', hint: 'field.patternRequireApproval.hint', kind: 'boolean', group: 'patternExtraction' },
  { path: ['patternExtraction', 'thresholds', 'preferenceMinProjects'], id: 'memory-pattern-preference-projects', label: 'field.patternPreferenceProjects.label', hint: 'field.patternPreferenceProjects.hint', kind: 'number', min: 1, step: 1, group: 'patternExtraction' },
  { path: ['patternExtraction', 'thresholds', 'failureMinOccurrences'], id: 'memory-pattern-failure-occurrences', label: 'field.patternFailureOccurrences.label', hint: 'field.patternFailureOccurrences.hint', kind: 'number', min: 1, step: 1, group: 'patternExtraction' },
  { path: ['patternExtraction', 'thresholds', 'environmentMinProjects'], id: 'memory-pattern-environment-projects', label: 'field.patternEnvironmentProjects.label', hint: 'field.patternEnvironmentProjects.hint', kind: 'number', min: 1, step: 1, group: 'patternExtraction' },
  { path: ['patternExtraction', 'thresholds', 'workflowMinOccurrences'], id: 'memory-pattern-workflow-occurrences', label: 'field.patternWorkflowOccurrences.label', hint: 'field.patternWorkflowOccurrences.hint', kind: 'number', min: 1, step: 1, group: 'patternExtraction' },
  { path: ['patternExtraction', '__actions'], id: 'memory-pattern-actions', label: 'field.patternActions.label', hint: 'field.patternActions.hint', kind: 'boolean', group: 'patternExtraction', hidden: true },
  { path: ['patternApplication', 'injectHotPack'], id: 'memory-pattern-inject-hot-pack', label: 'field.patternInjectHotPack.label', hint: 'field.patternInjectHotPack.hint', kind: 'boolean', group: 'patternApplication' },
  { path: ['patternApplication', 'sceneMatching'], id: 'memory-pattern-scene-matching', label: 'field.patternSceneMatching.label', hint: 'field.patternSceneMatching.hint', kind: 'boolean', group: 'patternApplication' },
  { path: ['patternApplication', 'feedbackCollection'], id: 'memory-pattern-feedback', label: 'field.patternFeedback.label', hint: 'field.patternFeedback.hint', kind: 'boolean', group: 'patternApplication' },
  { path: ['patternApplication', 'matchThreshold'], id: 'memory-pattern-match-threshold', label: 'field.patternMatchThreshold.label', hint: 'field.patternMatchThreshold.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'patternApplication' },
  { path: ['patternApplication', 'hotPackPatternsBudget'], id: 'memory-pattern-hot-pack-budget', label: 'field.patternHotPackBudget.label', hint: 'field.patternHotPackBudget.hint', kind: 'number', min: 1, step: 256, group: 'patternApplication' },
  { path: ['curation', 'enabled'], id: 'memory-curation-enabled', label: 'field.curationEnabled.label', hint: 'field.curationEnabled.hint', kind: 'boolean', group: 'curation' },
  { path: ['curation', 'provider'], id: 'memory-curation-provider', label: 'field.curationProvider.label', hint: 'field.curationProvider.hint', kind: 'select', source: 'providers', group: 'curation' },
  { path: ['curation', 'model'], id: 'memory-curation-model', label: 'field.curationModel.label', hint: 'field.curationModel.hint', kind: 'select', source: 'models', group: 'curation' },
  { path: ['curation', 'schedule'], id: 'memory-curation-schedule', label: 'field.curationSchedule.label', hint: 'field.curationSchedule.hint', kind: 'select', options: ENUM_OPTIONS.schedule, group: 'curation' },
  { path: ['llmDistill', 'enabled'], id: 'memory-distill', label: 'field.distill.label', hint: 'field.distill.hint', kind: 'boolean', group: 'curation' },
  { path: ['llmDistill', 'provider'], id: 'memory-distill-provider', label: 'field.distillProvider.label', hint: 'field.distillProvider.hint', kind: 'select', source: 'providers', group: 'curation' },
  { path: ['llmDistill', 'model'], id: 'memory-distill-model', label: 'field.distillModel.label', hint: 'field.distillModel.hint', kind: 'select', source: 'models', group: 'curation' },
  { path: ['integrations', 'autoDetect'], id: 'memory-integrations-auto-detect', label: 'field.integrationsAutoDetect.label', hint: 'field.integrationsAutoDetect.hint', kind: 'boolean', group: 'integrations' },
  { path: ['integrations', 'toolkit', 'enabled'], id: 'memory-integrations-toolkit-enabled', label: 'field.integrationsToolkitEnabled.label', hint: 'field.integrationsToolkitEnabled.hint', kind: 'select', options: ENUM_OPTIONS.toolkitEnabled, group: 'integrations' },
  { path: ['integrations', 'toolkit', 'readHotPackSection'], id: 'memory-integrations-read-section', label: 'field.integrationsReadSection.label', hint: 'field.integrationsReadSection.hint', kind: 'boolean', group: 'integrations' },
  { path: ['integrations', 'toolkit', 'writeBackOnApproval'], id: 'memory-integrations-write-back', label: 'field.integrationsWriteBack.label', hint: 'field.integrationsWriteBack.hint', kind: 'boolean', group: 'integrations' },
  { path: ['capacity', 'workingMemorySlots'], id: 'memory-working-capacity', label: 'field.workingCapacity.label', hint: 'field.workingCapacity.hint', kind: 'number', min: 1, step: 1, group: 'retrieval' },
  { path: ['capacity', 'stagingPoolCapacity'], id: 'memory-staging-capacity', label: 'field.stagingCapacity.label', hint: 'field.stagingCapacity.hint', kind: 'number', min: 1, step: 1, group: 'retrieval' },
  { path: ['capacity', 'recallTopK'], id: 'memory-top-k', label: 'field.topK.label', hint: 'field.topK.hint', kind: 'number', min: 1, step: 1, group: 'retrieval' },
  { path: ['capacity', 'similarityThreshold'], id: 'memory-similarity', label: 'field.similarityThreshold.label', hint: 'field.similarityThreshold.hint', kind: 'number', min: 0, max: 1, step: 0.05, group: 'retrieval' },
  { path: ['capacity', 'recallBlockMaxChars'], id: 'memory-recall-chars', label: 'field.recallMaxChars.label', hint: 'field.recallMaxChars.hint', kind: 'number', min: 1, step: 100, group: 'retrieval' },
  { path: ['injection', 'injectHotPack'], id: 'memory-hot-pack', label: 'field.hotPack.label', hint: 'field.hotPack.hint', kind: 'boolean', group: 'retrieval' },
  { path: ['authorization', 'usePolicyPlane'], id: 'memory-authorization', label: 'field.authorization.label', hint: 'field.authorization.hint', kind: 'boolean', group: 'authorization' },
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
  const {
    settings, t, distillTargets, downloadModel, modelDownloadStatus, revealModelFile,
    patterns, extractPatternsNow, decidePattern,
  } = props
  const [snapshot, setSnapshot] = useState<SettingsSnapshotView>(() => settings.snapshot())
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [download, setDownload] = useState<DownloadView | undefined>(undefined)
  const [panelOpen, setPanelOpen] = useState(false)
  const [patternRows, setPatternRows] = useState<PatternRow[]>([])
  const [extracting, setExtracting] = useState(false)
  const [deciding, setDeciding] = useState<string | undefined>(undefined)
  /**
   * Which action the message on screen belongs to.
   *
   * A failed download and a failed save share one paragraph, and labelling both
   * "保存失败" made a download error read as a settings error — which is how a
   * missing model path first looked like a save problem.
   */
  const [failureOf, setFailureOf] = useState<'save' | 'download'>('save')

  // The scope publishes through a snapshot store, so the form subscribes rather
  // than polling: a write from anywhere else (another tab, a file edit) has to
  // reach this form's inputs.
  useEffect(() => {
    setSnapshot(settings.snapshot())
    return settings.subscribe(() => { setSnapshot(settings.snapshot()) })
  }, [settings])

  const write = async (ops: Parameters<MemorySettingsFace['mutate']>[0]): Promise<void> => {
    setFailure(undefined)
    setFailureOf('save')
    try {
      await settings.mutate(ops)
      setSaved(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Ask the host whether the model is already on disk.
   *
   * Runs once on mount so a machine that downloaded in an earlier session
   * shows the finished state immediately instead of offering a second fetch.
   */
  useEffect(() => {
    if (modelDownloadStatus === undefined) return
    let active = true
    void modelDownloadStatus()
      .then((value): void => {
        if (active) setDownload(downloadViewOf(value))
      })
      .catch((): void => {
        // A status probe that fails is not worth surfacing: the download button
        // still works, and the download attempt produces the real error.
      })
    return (): void => {
      active = false
    }
  }, [modelDownloadStatus])

  /** Poll the download's progress while one is running. */
  useEffect(() => {
    if (download?.status !== 'downloading' || modelDownloadStatus === undefined) return
    const timer = setInterval((): void => {
      void modelDownloadStatus()
        .then((value): void => {
          const next = downloadViewOf(value)
          if (next !== undefined) setDownload(next)
        })
        .catch((): void => {
          // Keep the last known progress rather than blanking the bar.
        })
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [download?.status, modelDownloadStatus])

  /** The download is long enough that the button has to say so, and a failure
   *  has to reach the same place a failed save does rather than vanish. */
  const runDownload = async (): Promise<void> => {
    if (downloadModel === undefined) return
    setFailure(undefined)
    setFailureOf('download')
    try {
      const started = downloadViewOf(await downloadModel())
      if (started !== undefined) setDownload(started)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const runReveal = async (): Promise<void> => {
    if (revealModelFile === undefined) return
    setFailure(undefined)
    try {
      await revealModelFile()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const runExtract = async (): Promise<void> => {
    if (extractPatternsNow === undefined) return
    setFailure(undefined)
    setExtracting(true)
    try {
      await extractPatternsNow()
      // Re-read the list so the panel shows what the run just produced.
      if (patterns !== undefined) {
        const rows = patternRowsOf(await patterns())
        setPatternRows(rows)
        setPanelOpen(true)
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setExtracting(false)
    }
  }

  const openPanel = async (): Promise<void> => {
    if (patterns === undefined) return
    setFailure(undefined)
    try {
      setPatternRows(patternRowsOf(await patterns()))
      setPanelOpen(open => !open)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const runDecide = async (
    patternId: string,
    action: 'approve' | 'reject' | 'disable' | 'enable',
  ): Promise<void> => {
    if (decidePattern === undefined) return
    setFailure(undefined)
    setDeciding(patternId)
    try {
      await decidePattern(patternId, action)
      // Re-read so the row shows its new state rather than a stale one; a
      // decision the panel does not reflect looks like it did not land.
      if (patterns !== undefined) setPatternRows(patternRowsOf(await patterns()))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setDeciding(undefined)
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
    if (field.options !== undefined) return field.options
    if (field.source === 'providers') return distillTargets.providers.map(entry => entry.provider)
    const match = distillTargets.providers.find(entry => entry.provider === selectedProvider)
    return match?.models ?? []
  }
  const labelsFor = (field: FieldSpec): Record<string, string> => {
    if (field.options !== undefined) {
      return Object.fromEntries(
        field.options.map(option => [option, t(ENUM_LABELS[option] ?? (option as MemoryLocaleKey))]),
      )
    }
    if (field.source !== 'providers') return {}
    return Object.fromEntries(distillTargets.providers.map(entry => [entry.provider, entry.displayName]))
  }

  return (
    <div className={css.form}>
      {GROUP_ORDER.map(({ group, title, hint }) => {
        const fields = FIELDS.filter(field => field.group === group)
        if (fields.length === 0) return null
        return (
          <section key={group} className={css.group}>
            <h3 className={css.groupTitle}>{t(title)}</h3>
            <p className={css.groupHint}>{t(hint)}</p>
            {fields.map(field => (field.hidden === true
              ? null
              : (
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
              )))}
            {group === 'patternExtraction' && (patterns !== undefined || extractPatternsNow !== undefined) && (
              <div className={css.row}>
                <div className={css.rowText}>
                  <span className={css.label}>{t('field.patternActions.label')}</span>
                  <span className={css.hint}>{t('field.patternActions.hint')}</span>
                </div>
                <div className={css.rowControl}>
                  <Button onClick={() => { void openPanel() }} disabled={patterns === undefined}>
                    {t('field.patternPanel.open')}
                  </Button>
                  <Button
                    onClick={() => { void runExtract() }}
                    disabled={extractPatternsNow === undefined || extracting}
                  >
                    {extracting ? t('field.patternPanel.running') : t('field.patternPanel.extract')}
                  </Button>
                </div>
              </div>
            )}
            {group === 'patternExtraction' && panelOpen && (
              <div className={css.panel}>
                {patternRows.length === 0
                  ? <p className={css.muted}>{t('field.patternPanel.empty')}</p>
                  : patternRows.map(row => (
                    <div key={row.id} className={css.patternRow}>
                      <div className={css.patternBody}>
                        <span className={css.patternContent}>{row.content}</span>
                        <span className={css.patternMeta}>
                          {t('field.patternPanel.meta', {
                            kind: row.kind,
                            state: row.state,
                            confidence: row.confidence.toFixed(2),
                            occurrences: row.occurrenceCount,
                            projects: row.projectCount,
                          })}
                        </span>
                      </div>
                      {decidePattern !== undefined && (
                        <div className={css.rowControl}>
                          {(row.state === 'candidate' || row.state === 'user-disabled') && (
                            <Button
                              onClick={() => { void runDecide(row.id, 'approve') }}
                              disabled={deciding !== undefined}
                            >
                              {t('field.patternPanel.approve')}
                            </Button>
                          )}
                          {row.state === 'candidate' && (
                            <Button
                              onClick={() => { void runDecide(row.id, 'reject') }}
                              disabled={deciding !== undefined}
                            >
                              {t('field.patternPanel.reject')}
                            </Button>
                          )}
                          {row.state === 'active' && (
                            <Button
                              onClick={() => { void runDecide(row.id, 'disable') }}
                              disabled={deciding !== undefined}
                            >
                              {t('field.patternPanel.disable')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
            {group === 'judgment' && downloadModel !== undefined && (
              <div className={css.row}>
                <div className={css.rowText}>
                  <span className={css.label}>{t('field.downloadModel.label')}</span>
                  <span className={css.hint}>
                    {download?.status === 'done'
                      ? `${t('field.downloadModel.done')} ${download.path}`
                      : t('field.downloadModel.hint')}
                  </span>
                </div>
                <div className={css.rowControl}>
                  {download?.status === 'done'
                    ? (
                      <>
                        <span className={css.hint}>{t('field.downloadModel.done')}</span>
                        <Button onClick={() => { void runReveal() }}>
                          {t('field.downloadModel.reveal')}
                        </Button>
                      </>
                    )
                    : (
                      <Button
                        onClick={() => { void runDownload() }}
                        disabled={download?.status === 'downloading'}
                      >
                        {download?.status === 'downloading'
                          ? t('field.downloadModel.running')
                          : t('field.downloadModel.action')}
                      </Button>
                    )}
                </div>
              </div>
            )}
            {group === 'judgment' && download?.status === 'downloading' && (
              <div className={css.row}>
                <div className={css.rowText}>
                  <span className={css.hint}>
                    {`${formatBytes(download.receivedBytes, t)} / ${
                      download.totalBytes > 0 ? formatBytes(download.totalBytes, t) : '?'
                    }`}
                  </span>
                </div>
                <div className={css.rowControl}>
                  <progress
                    className={css.progress}
                    value={download.totalBytes > 0 ? download.receivedBytes / download.totalBytes : undefined}
                  />
                </div>
              </div>
            )}
          </section>
        )
      })}
      {failure !== undefined && (
        <p className={css.error}>
          {failureOf === 'download' ? t('settingsDownloadFailed') : t('settingsFailed')} {failure}
        </p>
      )}
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
          {field.kind === 'select' && empty && field.options === undefined && ` ${t('settingsNoModels')}`}
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
