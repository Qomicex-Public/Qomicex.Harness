/**
 * Personalization Settings page: the master switch, the background paint, the
 * theme-colour anchor, the glass surfaces, and the corner decoration.
 *
 * Edits are local until **Save**, which writes every field the page owns as one
 * atomic namespace mutation; the client plugin then re-applies its effects from
 * the accepted value. Uploaded images go straight to IndexedDB as Blobs, so the
 * settings document never carries image bytes.
 */

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Input, Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonalizationLocaleKey } from './locales.ts'
import { readValue, saveOps, resetOps, firstInvalidColor, THEME_COLOR_PRESETS, type PersonalizationPathOp } from './model.ts'
import {
  BACKGROUND_MODES, CORNER_POSITIONS, GLASS_BLUR_MAX,
  type BackgroundMode, type CornerPosition, type PersonalizationSettings,
} from '../personalization-settings.ts'
import { BACKGROUND_IMAGE_KEY, CORNER_IMAGE_KEY, deleteImage, getImage, putImage } from './background-store.ts'
import css from './PersonalizationSection.module.css'

/** The part of a settings snapshot the page reads. */
export interface PersonalizationSnapshot {
  /** `loading` before the first read, `ready` once one stands, `unavailable` without a provider. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Resolved section value; meaningful only when `status` is `ready`. */
  readonly value: unknown
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
}

/** The settings face for the personalization namespace; absent when no provider is mounted. */
export interface PersonalizationFace {
  /** Current snapshot of the personalization settings section. */
  readonly snapshot: () => PersonalizationSnapshot
  /** Subscribe to section changes. */
  readonly subscribe: (listener: () => void) => () => void
  /** Apply path-addressed writes to the user section. */
  readonly mutate: (ops: readonly PersonalizationPathOp[]) => Promise<void>
}

/** Registration-side face used by the page. */
export interface PersonalizationInjected {
  /** The settings face, or `undefined` when no settings provider is mounted. */
  readonly settings: PersonalizationFace | undefined
}

/** Full component props assembled by the Settings slot renderer. */
export type PersonalizationSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.personalization'>
  & InjectFace<PersonalizationInjected>

/** The page's own feedback line state. */
type Feedback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'invalid'; readonly field: string }

/**
 * Render the Personalization page.
 * @param props - composed slot props.
 * @returns the page element tree.
 */
export function PersonalizationSection(props: PersonalizationSectionProps): ReactNode {
  const { settings, t } = props
  if (settings === undefined) return <p className={css.muted}>{t('unavailable')}</p>
  return <PersonalizationForm settings={settings} t={t} />
}

/**
 * Render the page form over a mounted settings face.
 * @param props - the settings face and the page's translate seat.
 * @returns the form element tree.
 */
export function PersonalizationForm(props: {
  readonly settings: PersonalizationFace
  readonly t: (key: PersonalizationLocaleKey) => string
}): ReactNode {
  const { settings, t } = props
  const [snapshot, setSnapshot] = useState<PersonalizationSnapshot>(() => settings.snapshot())
  const [draft, setDraft] = useState<PersonalizationSettings>(() => readValue(settings.snapshot().value))
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })
  const [imageRevision, setImageRevision] = useState(0)
  const backgroundImageUrl = useStoredImageUrl(BACKGROUND_IMAGE_KEY, imageRevision)
  const cornerImageUrl = useStoredImageUrl(CORNER_IMAGE_KEY, imageRevision)

  // A write from anywhere else (another tab, a file edit) has to reach these
  // controls, so the form subscribes instead of caching the first read.
  useEffect(() => {
    setSnapshot(settings.snapshot())
    setDraft(readValue(settings.snapshot().value))
    return settings.subscribe(() => {
      setSnapshot(settings.snapshot())
      setDraft(readValue(settings.snapshot().value))
    })
  }, [settings])

  if (snapshot.status !== 'ready') {
    return <p className={css.muted}>{snapshot.status === 'loading' ? t('loading') : t('unavailable')}</p>
  }

  const disabled = !snapshot.writable
  const update = (patch: Partial<PersonalizationSettings>): void => { setDraft(current => ({ ...current, ...patch })) }

  const write = async (ops: readonly PersonalizationPathOp[]): Promise<void> => {
    setFeedback({ kind: 'idle' })
    try {
      await settings.mutate(ops)
      setFeedback({ kind: 'saved' })
    } catch (error) {
      setFeedback({ kind: 'failed', message: String(error) })
    }
  }

  const save = (): void => {
    const invalid = firstInvalidColor(draft)
    if (invalid !== undefined) {
      setFeedback({ kind: 'invalid', field: invalid })
      return
    }
    void write(saveOps(draft))
  }

  const readImage = async (key: string, file: File): Promise<void> => {
    try {
      await putImage(key, file)
      setImageRevision(revision => revision + 1)
    } catch (error) {
      setFeedback({ kind: 'failed', message: `${t('imageReadFailed')}${String(error)}` })
    }
  }

  const removeImage = async (key: string, patch: Partial<PersonalizationSettings>): Promise<void> => {
    await deleteImage(key)
    setImageRevision(revision => revision + 1)
    update(patch)
  }

  const background = draft.background
  const glassOn = draft.enabled && draft.glass.enabled

  return (
    <div className={css.page}>
      <Toggle id="p13n-enabled" label={t('enabled')} checked={draft.enabled} disabled={disabled}
        onChange={(enabled) => { update({ enabled }) }} />
      <p className={css.hint}>{t('enabledHint')}</p>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('backgroundTitle')}</h3>
        <div className={css.row}>
          <span className={css.cellLabel}>{t('backgroundMode')}</span>
          {BACKGROUND_MODES.map(mode => (
            <label key={mode} className={css.choice}>
              <input type="radio" name="p13n-bg-mode" checked={background.mode === mode} disabled={disabled}
                onChange={() => { update({ background: { ...background, mode } }) }} />
              <span>{t(modeKey(mode))}</span>
            </label>
          ))}
        </div>
        {background.mode === 'solid' && (
          <ColorField id="p13n-bg-solid" label={t('solidColor')} value={background.solid} disabled={disabled}
            placeholder={t('colorPlaceholder')}
            onChange={(solid) => { update({ background: { ...background, solid } }) }} />
        )}
        {background.mode === 'gradient' && (
          <>
            <ColorField id="p13n-bg-from" label={t('gradientFrom')} value={background.gradientFrom} disabled={disabled}
              placeholder={t('colorPlaceholder')}
              onChange={(gradientFrom) => { update({ background: { ...background, gradientFrom } }) }} />
            <ColorField id="p13n-bg-to" label={t('gradientTo')} value={background.gradientTo} disabled={disabled}
              placeholder={t('colorPlaceholder')}
              onChange={(gradientTo) => { update({ background: { ...background, gradientTo } }) }} />
            <RangeField id="p13n-bg-angle" label={t('gradientAngle')} min={0} max={360} value={background.angle} disabled={disabled}
              onChange={(angle) => { update({ background: { ...background, angle } }) }} />
          </>
        )}
        {background.mode === 'image' && (
          <>
            <div className={css.row}>
              <span className={css.cellLabel}>{t('imageSource')}</span>
              {(['blob', 'url'] as const).map(source => (
                <label key={source} className={css.choice}>
                  <input type="radio" name="p13n-image-source" checked={background.imageSource === source} disabled={disabled}
                    onChange={() => { update({ background: { ...background, imageSource: source } }) }} />
                  <span>{t(source === 'blob' ? 'imageSourceBlob' : 'imageSourceUrl')}</span>
                </label>
              ))}
            </div>
            {background.imageSource === 'blob'
              ? (
                <>
                  <ImagePicker id="p13n-bg-file" label={t('imageUpload')} removeLabel={t('imageRemove')}
                    disabled={disabled} previewLabel={t('imagePreview')} previewUrl={backgroundImageUrl}
                    noneLabel={t('imageNone')}
                    onUpload={(file) => { void readImage(BACKGROUND_IMAGE_KEY, file) }}
                    onRemove={() => { void removeImage(BACKGROUND_IMAGE_KEY, { background: { ...background, imageUrl: '' } }) }} />
                </>
              )
              : (
                <TextField id="p13n-bg-url" label={t('imageUrl')} placeholder={t('imageUrlPlaceholder')}
                  value={background.imageUrl} disabled={disabled}
                  onChange={(imageUrl) => { update({ background: { ...background, imageUrl } }) }} />
              )}
          </>
        )}
        {background.mode !== 'none' && (
          <RangeField id="p13n-overlay" label={t('overlay')} min={0} max={100} value={background.overlay} disabled={disabled}
            onChange={(overlay) => { update({ background: { ...background, overlay } }) }} />
        )}
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('themeColorTitle')}</h3>
        <p className={css.hint}>{t('themeColorHint')}</p>
        <ColorField id="p13n-theme-color" label={t('themeColorLabel')} value={draft.themeColor} disabled={disabled}
          placeholder={t('colorPlaceholder')}
          onChange={(themeColor) => { update({ themeColor }) }} />
        <div className={css.row}>
          <Button disabled={disabled} onClick={() => { void pickWithEyedropper((hex) => { update({ themeColor: hex }) }) }}>
            {t('eyedropper')}
          </Button>
          <Button disabled={disabled || draft.themeColor === ''} onClick={() => { update({ themeColor: '' }) }}>
            {t('clearThemeColor')}
          </Button>
        </div>
        <div className={css.row}>
          <span className={css.cellLabel}>{t('presets')}</span>
          {THEME_COLOR_PRESETS.map(preset => (
            <button key={preset} type="button" className={css.swatch} style={{ background: preset }}
              disabled={disabled} aria-label={preset} title={preset}
              onClick={() => { update({ themeColor: preset }) }} />
          ))}
        </div>
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('glassTitle')}</h3>
        <Toggle id="p13n-glass" label={t('glassEnabled')} checked={draft.glass.enabled} disabled={disabled}
          onChange={(enabled) => { update({ glass: { ...draft.glass, enabled } }) }} />
        {([
          ['sidebar', 'glassSidebar'],
          ['composer', 'glassComposer'],
          ['conversation', 'glassConversation'],
          ['settings', 'glassSettings'],
          ['code', 'glassCode'],
        ] as const).map(([field, labelKey]) => (
          <Toggle key={field} id={`p13n-glass-${field}`} label={t(labelKey)} checked={glassOn && draft.glass[field]}
            disabled={disabled || !draft.glass.enabled}
            onChange={(on) => { update({ glass: { ...draft.glass, [field]: on } }) }} />
        ))}
        <RangeField id="p13n-glass-blur" label={t('glassBlur')} min={0} max={GLASS_BLUR_MAX} value={draft.glass.blur}
          disabled={disabled || !draft.glass.enabled}
          onChange={(blur) => { update({ glass: { ...draft.glass, blur } }) }} />
      </section>

      <section className={css.block}>
        <h3 className={css.blockTitle}>{t('cornerTitle')}</h3>
        <Toggle id="p13n-corner" label={t('cornerEnabled')} checked={draft.corner.enabled} disabled={disabled}
          onChange={(enabled) => { update({ corner: { ...draft.corner, enabled } }) }} />
        <div className={css.cell}>
          <span className={css.cellLabel}>{t('cornerPosition')}</span>
          <PositionMenu
            value={draft.corner.position}
            disabled={disabled || !draft.corner.enabled}
            t={t}
            onChange={(position) => { update({ corner: { ...draft.corner, position } }) }}
          />
        </div>
        <ImagePicker id="p13n-corner-file" label={t('cornerUpload')} removeLabel={t('cornerRemove')}
          disabled={disabled || !draft.corner.enabled} previewLabel={t('cornerCurrent')} previewUrl={cornerImageUrl}
          noneLabel={t('cornerNone')}
          onUpload={(file) => { void readImage(CORNER_IMAGE_KEY, file) }}
          onRemove={() => { void removeImage(CORNER_IMAGE_KEY, {}) }} />
      </section>

      <div className={css.actions}>
        <Button disabled={disabled} onClick={save}>{t('save')}</Button>
        <Button disabled={disabled} onClick={() => { void write(resetOps()) }}>{t('reset')}</Button>
      </div>
      {feedback.kind === 'saved' && <p className={css.ok}>{t('saved')}</p>}
      {feedback.kind === 'failed' && <p className={css.error}>{t('failed')} {feedback.message}</p>}
      {feedback.kind === 'invalid' && <p className={css.error}>{t('invalidColor')} {feedback.field}</p>}
    </div>
  )
}

/** Locale key for one background mode. */
function modeKey(mode: BackgroundMode): PersonalizationLocaleKey {
  return mode === 'none' ? 'modeNone' : mode === 'solid' ? 'modeSolid' : mode === 'gradient' ? 'modeGradient' : 'modeImage'
}

/**
 * A labelled dropdown for the corner decoration position.
 * @param props - current position, disabled, translate, and the change callback.
 * @returns the position selector.
 */
function PositionMenu(props: {
  readonly value: CornerPosition
  readonly disabled: boolean
  readonly t: (key: PersonalizationLocaleKey) => string
  readonly onChange: (position: CornerPosition) => void
}): ReactNode {
  const { value, disabled, t, onChange } = props
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={CORNER_POSITIONS.map(position => ({ id: position, label: t(positionKey(position)) }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onChange(id as CornerPosition)
      }}
      align="end"
      anchor={(
        <button
          type="button"
          className={css.selectButton}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          {t(positionKey(value))}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}

/** Locale key for one corner position. */
function positionKey(position: CornerPosition): PersonalizationLocaleKey {
  return position === 'top-left' ? 'positionTopLeft'
    : position === 'top-right' ? 'positionTopRight'
      : position === 'bottom-right' ? 'positionBottomRight'
        : 'positionBottomLeft'
}

/**
 * Open the browser eyedropper and report the chosen colour.
 * @param onPick - receives the picked `#rrggbb`; not called when unsupported or cancelled.
 * @returns a promise settling when the picker closes.
 */
async function pickWithEyedropper(onPick: (hex: string) => void): Promise<void> {
  const Ctor = (globalThis as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
  if (Ctor === undefined) return
  try {
    const result = await new Ctor().open()
    onPick(result.sRGBHex.toLowerCase())
  } catch {
    // A cancelled picker rejects; cancellation is not an error.
  }
}

/**
 * Load one stored image as an object URL for preview.
 * @param key - the IndexedDB image key.
 * @param revision - bump to reload after an upload or removal.
 * @returns the object URL, or `undefined` when no image is stored.
 */
function useStoredImageUrl(key: string, revision: number): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let active = true
    let created: string | undefined
    void getImage(key).then((blob) => {
      if (!active || blob === undefined) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      active = false
      if (created !== undefined) URL.revokeObjectURL(created)
      setUrl(undefined)
    }
  }, [key, revision])
  return url
}

/** A labelled toggle switch. */
function Toggle(props: {
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}): ReactNode {
  const { id, label, checked, disabled, onChange } = props
  return (
    <div className={css.switch}>
      <Switch
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={onChange}
      />
      <span id={id} className={css.switchLabel}>{label}</span>
    </div>
  )
}

/** A colour control: a native picker plus a hex text field. */
function ColorField(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly placeholder: string
  readonly onChange: (value: string) => void
}): ReactNode {
  const { id, label, value, disabled, placeholder } = props
  return (
    <div className={css.row}>
      <label className={css.cellLabel} htmlFor={id}>{label}</label>
      <input id={`${id}-picker`} className={css.color} type="color" value={value === '' ? '#000000' : value}
        disabled={disabled}
        onChange={(event) => { props.onChange(event.target.value.toLowerCase()) }} />
      <input id={id} className={css.input} type="text" value={value} placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => { props.onChange(event.target.value.trim()) }} />
    </div>
  )
}

/** A labelled text field. */
function TextField(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly placeholder?: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}): ReactNode {
  return (
    <label className={css.cell} htmlFor={props.id}>
      <span className={css.cellLabel}>{props.label}</span>
      <Input id={props.id} className={css.inputCell} type="text" value={props.value} placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) => { props.onChange(event.target.value.trim()) }} />
    </label>
  )
}

/** A labelled range control with a numeric readout. */
function RangeField(props: {
  readonly id: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly value: number
  readonly disabled: boolean
  readonly onChange: (value: number) => void
}): ReactNode {
  const { id, label, min, max, value, disabled } = props
  return (
    <div className={css.row}>
      <label className={css.cellLabel} htmlFor={id}>{label}</label>
      <input id={id} className={css.range} type="range" min={min} max={max} value={value} disabled={disabled}
        onChange={(event) => { props.onChange(event.target.valueAsNumber) }} />
      <span className={css.readout}>{value}</span>
    </div>
  )
}

/** A file picker with a preview and a remove control. */
function ImagePicker(props: {
  readonly id: string
  readonly label: string
  readonly removeLabel: string
  readonly previewLabel: string
  readonly noneLabel: string
  readonly disabled: boolean
  readonly previewUrl: string | undefined
  readonly onUpload: (file: File) => void
  readonly onRemove: () => void
}): ReactNode {
  const { id, label, removeLabel, previewLabel, noneLabel, disabled, previewUrl } = props
  return (
    <div className={css.cell}>
      <label className={css.cellLabel} htmlFor={id}>{label}</label>
      <input id={id} type="file" accept="image/*" disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          if (file !== undefined) props.onUpload(file)
          event.target.value = ''
        }} />
      <div className={css.preview}>
        <span className={css.cellLabel}>{previewLabel}</span>
        {previewUrl === undefined
          ? <span className={css.muted}>{noneLabel}</span>
          : <img className={css.thumb} src={previewUrl} alt={previewLabel} />}
        <Button disabled={disabled || previewUrl === undefined} onClick={props.onRemove}>{removeLabel}</Button>
      </div>
    </div>
  )
}
