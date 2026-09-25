/**
 * Provider selection row registered into the General section item slot
 * (figma 501:30011 'Setting-Cell'): title + selector pill choosing which
 * backend serves web_search or web_fetch. Registered twice by this package —
 * once per capability — over the `web` Host settings namespace.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createWebProviderRowStore } from './settings-store.ts'
import type { WebSettingsKey } from './locales.ts'
import css from './WebProviderRow.module.css'

/** Injected business face: which capability this row selects, and its write. */
export interface WebProviderRowInjected {
  /** The capability this row selects. */
  provider: 'search' | 'fetch'
  /** Write the selected provider id into the `web` settings namespace. */
  setProvider: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type WebProviderRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createWebProviderRowStore>>
  & PropsLocale<'settings.web'> & WebProviderRowInjected

/** Candidate provider ids per capability; a value outside the list still displays. */
const OPTIONS = {
  search: ['firecrawl', 'deepseek-official', 'exa', 'perplexity'],
  fetch: ['firecrawl', 'http'],
} as const

/** The dictionary key naming one provider's display label. */
function labelKey(id: string): WebSettingsKey {
  return `provider.${id}` as WebSettingsKey
}

/**
 * Render one provider selection row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function WebProviderRow({ t, provider, setProvider, useStore }: WebProviderRowComponentProps) {
  const active = useStore(s => provider === 'search' ? s.search : s.fetch)
  const options = OPTIONS[provider]
  const [open, setOpen] = useState(false)
  const activeLabel = active.length > 0 ? t(labelKey(active)) : ''

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(provider === 'search' ? 'search.title' : 'fetch.title')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(id => ({ id, label: t(labelKey(id)) }))}
        selectedId={active}
        onSelect={(id) => {
          setProvider(id)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            {activeLabel}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
