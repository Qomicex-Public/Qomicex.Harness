import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { QOMICEX_MARK_DATA_URL } from './mark.ts'
import type { QomicexBrandLocaleKey } from './locales.ts'

/**
 * Render the Qomicex mark at the square edge its host surface requests.
 * @param props - Host-supplied mark presentation.
 * @returns the Qomicex mark image.
 */
export function QomicexBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <QomicexMarkImage size={size} />
}

/**
 * Render the Qomicex mark in the new-session hero at the requested edge.
 * @param props - Hero-supplied mark presentation.
 * @returns the Qomicex mark image.
 */
export function QomicexHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <QomicexMarkImage size={size} className={className} />
}

/**
 * Render the Qomicex name beside the sidebar mark.
 *
 * The name is set as text rather than artwork: the supplied logo is a raster
 * export, so a text wordmark stays crisp and adapts to the theme foreground.
 * @param props - Owner share plus the framework `t` seat the registration declares.
 * @returns the Qomicex wordmark.
 */
export function QomicexBrandName({ t }: SidebarBrandNameOwnerProps & {
  readonly t: (key: QomicexBrandLocaleKey) => string
}) {
  return <span className="qomicex-brand-name">{t('brandName')}</span>
}

/**
 * Render the mark image shared by every brand surface.
 * @param props - Requested square edge and optional host class.
 * @returns the mark image element.
 */
function QomicexMarkImage({ size, className }: { size: number; className?: string | undefined }) {
  return (
    <img
      src={QOMICEX_MARK_DATA_URL}
      width={size}
      height={size}
      className={className}
      alt=""
      draggable={false}
    />
  )
}
