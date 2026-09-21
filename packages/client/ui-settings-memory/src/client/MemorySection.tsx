/**
 * Memory Settings page: the plugin configuration and a preview of every stored
 * memory.
 *
 * The preview is a force-directed graph the page lays out itself — the repo has
 * no graph library and the algorithm is small enough not to need one.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryGraphValue, MemoryNodeView } from '@deepseek-ai/dsh-api-memory-controller/types'
import { ForceGraph } from './ForceGraph.tsx'
import type { GraphEdge, GraphNode } from './ForceGraph.tsx'
import { MemorySettingsForm } from './MemorySettingsForm.tsx'
import css from './MemorySection.module.css'

/** Outcome of a Remote read the page performs. */
export type LoadOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed'; readonly code: string; readonly message: string }

/** The part of a settings snapshot the page reads. */
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
export interface MemorySettingsFace {
  /** Current snapshot of the memory settings section. */
  readonly snapshot: () => SettingsSnapshotView
  /** Subscribe to section changes. */
  readonly subscribe: (listener: () => void) => () => void
  /** Apply path-addressed writes to the user section. */
  readonly mutate: (ops: readonly SettingsPathOp[]) => Promise<void>
}

/** Registration-side face used by the page. */
export interface MemorySectionInjected {
  /** Read the whole memory graph. */
  readonly loadGraph: () => Promise<LoadOutcome<MemoryGraphValue>>
  /** Read whether the plugin is mounted. */
  readonly loadStatus: () => Promise<{ readonly mounted: boolean; readonly total?: number }>
  /** Forget one memory. */
  readonly forget: (
    memoryId: string,
    mode: 'suppress' | 'delete' | 'deprecate',
  ) => Promise<LoadOutcome<{ readonly detail: string }>>
  /** The settings face, or `undefined` when no provider is mounted. */
  readonly settings: MemorySettingsFace | undefined
  /**
   * Providers and their configured models, for the distillation dropdowns.
   * Empty when the deployment exposes no provider directory.
   */
  readonly loadDistillTargets: () => Promise<DistillTargets>
  /**
   * Download the local judge model into the configured path. Absent when the
   * memory Remote namespace is not reachable, which is the same deployment that
   * leaves the graph empty.
   */
  readonly downloadModel?: () => Promise<LoadOutcome<{ readonly detail: string }>>
}

/** One provider and the model ids it declares, for the distillation dropdowns. */
export interface DistillProviderTarget {
  /** Provider route key, written to `llmDistill.provider`. */
  readonly provider: string
  /** Human-readable name shown in the dropdown. */
  readonly displayName: string
  /** Model ids this provider declares, written to `llmDistill.model`. */
  readonly models: readonly string[]
}

/** Every provider the Models page knows about. */
export interface DistillTargets {
  readonly providers: readonly DistillProviderTarget[]
}

/** Full component props assembled by the Settings slot renderer. */
export type MemorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.memory'>
  & InjectFace<MemorySectionInjected>

/** Map the controller's wire edges onto the renderer's shape. */
function toGraph(graph: MemoryGraphValue): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = graph.nodes.map((node: MemoryNodeView) => ({
    id: node.id,
    label: node.raw,
    kind: node.kind,
    lifecycle: node.lifecycle,
    weight: node.importance,
  }))
  const edges: GraphEdge[] = graph.edges.map(edge => ({
    source: edge.from,
    target: edge.to,
    kind: edge.kind,
  }))
  return { nodes, edges }
}

/**
 * Render the memory page.
 * @param props - composed slot props (see {@link MemorySectionProps}).
 * @returns the settings page element tree.
 */
export function MemorySection(props: MemorySectionProps): ReactNode {
  const { t, loadGraph, loadStatus, loadDistillTargets, downloadModel, settings } = props
  const [graph, setGraph] = useState<MemoryGraphValue | undefined>(undefined)
  const [mounted, setMounted] = useState<boolean | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [selected, setSelected] = useState<MemoryNodeView | undefined>(undefined)
  const [distillTargets, setDistillTargets] = useState<DistillTargets>({ providers: [] })

  const refresh = useCallback(async (): Promise<void> => {
    const status = await loadStatus()
    setMounted(status.mounted)
    if (!status.mounted) {
      setGraph(undefined)
      setFailure(undefined)
      return
    }
    const outcome = await loadGraph()
    if (outcome.kind === 'ok') {
      setGraph(outcome.value)
      setFailure(undefined)
    } else {
      setFailure(outcome.message)
    }
  }, [loadGraph, loadStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The provider directory is read once: it changes only when the Models page
  // adds or removes a provider, and a stale list is preferable to a request per
  // render. A failure leaves the dropdowns empty, which the form renders as a
  // prompt to configure a model rather than as an error.
  useEffect(() => {
    let active = true
    void loadDistillTargets()
      .then((targets) => { if (active) setDistillTargets(targets) })
      .catch(() => { if (active) setDistillTargets({ providers: [] }) })
    return () => { active = false }
  }, [loadDistillTargets])

  const layout = useMemo(() => (graph === undefined ? undefined : toGraph(graph)), [graph])

  if (mounted === false) {
    return (
      <section className={css.page}>
        <h2 className={css.title}>{t('nav')}</h2>
        <p className={css.muted}>{t('unavailable')}</p>
        <p className={css.hint}>{t('unavailableHint')}</p>
      </section>
    )
  }

  if (mounted === undefined) {
    return (
      <section className={css.page}>
        <h2 className={css.title}>{t('nav')}</h2>
        <p className={css.muted}>{t('loading')}</p>
      </section>
    )
  }

  return (
    <section className={css.page}>
      <h2 className={css.title}>{t('nav')}</h2>

      {failure !== undefined && (
        <p className={css.error}>
          {t('error')} {failure}
          <Button onClick={() => void refresh()}>{t('retry')}</Button>
        </p>
      )}

      <dl className={css.stats}>
        <div><dt>{t('total')}</dt><dd>{graph?.stats.total ?? 0}</dd></div>
        <div><dt>{t('linked')}</dt><dd>{graph?.stats.linked ?? 0}</dd></div>
        <div><dt>{t('scopes')}</dt><dd>{graph?.scopes.length ?? 0}</dd></div>
      </dl>

      <h3 className={css.subtitle}>{t('graphTitle')}</h3>
      <p className={css.hint}>{t('graphHint')}</p>
      {layout === undefined || layout.nodes.length === 0
        ? <p className={css.muted}>{t('graphEmpty')}</p>
        : (
          <ForceGraph
            nodes={layout.nodes}
            edges={layout.edges}
            selectedId={selected?.id}
            onSelect={(id) => {
              setSelected(graph?.nodes.find(node => node.id === id))
            }}
            labels={{
              sameFact: t('legendSameFact'),
              sameScope: t('legendSameScope'),
              hint: t('graphControls'),
            }}
          />
        )}

      {selected !== undefined && (
        <MemoryDetail
          node={selected}
          t={t}
          onClose={() => { setSelected(undefined) }}
        />
      )}

      <h3 className={css.subtitle}>{t('settingsTitle')}</h3>
      <p className={css.hint}>{t('settingsHint')}</p>
      {settings === undefined
        ? <p className={css.muted}>{t('settingsUnavailable')}</p>
        : (
          <MemorySettingsForm
            settings={settings}
            t={t}
            distillTargets={distillTargets}
            downloadModel={downloadModel === undefined
              ? undefined
              : async () => {
                const outcome = await downloadModel()
                if (outcome.kind === 'failed') throw new Error(outcome.message)
              }}
          />
        )}
    </section>
  )
}

/** The selected-memory panel. */
function MemoryDetail(props: {
  node: MemoryNodeView
  t: MemorySectionProps['t']
  onClose: () => void
}): ReactNode {
  const { node, t, onClose } = props
  return (
    <aside className={css.detail}>
      <header className={css.detailHeader}>
        <strong>{t('detail')}</strong>
        <Button onClick={onClose}>{t('detailClose')}</Button>
      </header>
      <p className={css.raw}>{node.raw}</p>
      <dl className={css.facts}>
        <div><dt>{t('detailScope')}</dt><dd>{node.scope}</dd></div>
        <div><dt>{t('detailLifecycle')}</dt><dd>{t(lifecycleKey(node.lifecycle))}</dd></div>
        <div><dt>{t('detailKind')}</dt><dd>{node.kind}</dd></div>
        <div><dt>{t('detailConfidence')}</dt><dd>{node.confidence.toFixed(2)}</dd></div>
        <div><dt>{t('detailImportance')}</dt><dd>{node.importance.toFixed(2)}</dd></div>
        <div><dt>{t('detailUsage')}</dt><dd>{node.usageCount}</dd></div>
        <div><dt>{t('detailForgetScore')}</dt><dd>{node.forgetScore.toFixed(2)}</dd></div>
        <div><dt>{t('detailObservedAt')}</dt><dd>{new Date(node.observedAt).toLocaleString()}</dd></div>
      </dl>
    </aside>
  )
}

/** The locale key for one lifecycle state. */
function lifecycleKey(state: string): 'lifecycleActive' | 'lifecycleStaging' | 'lifecycleConsolidated' | 'lifecycleDisputed' | 'lifecycleArchived' | 'lifecycleTombstoned' | 'lifecycleDeleted' {
  switch (state) {
    case 'staging': return 'lifecycleStaging'
    case 'consolidated': return 'lifecycleConsolidated'
    case 'disputed': return 'lifecycleDisputed'
    case 'archived': return 'lifecycleArchived'
    case 'tombstoned': return 'lifecycleTombstoned'
    case 'deleted': return 'lifecycleDeleted'
    default: return 'lifecycleActive'
  }
}
