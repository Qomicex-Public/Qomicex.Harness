/**
 * Integration modules: the optional bridge between the memory core and the
 * tools that already keep their own notes.
 *
 * The core does not know these exist. That is the whole design: an integration
 * is a *reader* of somebody else's memory and a *writer* only where that
 * somebody explicitly accepts a pattern. If every integration on the machine
 * fails to load, or none is installed, the core still captures, judges,
 * retains, extracts, applies, and curates exactly as before — it simply has
 * nothing extra to inject.
 *
 * Three seams, each optional, each separately disableable:
 *
 * - {@link Integration.collectHotPackSection} adds a section to the hot pack.
 * - {@link Integration.collectPatternEvidence} feeds the extractor a source it
 *   could not otherwise see.
 * - {@link Integration.writePatternOnApproval} writes a pattern the user
 *   approved back into the tool's own file, so the two stores agree.
 *
 * Detection is per integration and contained: one that throws does not stop
 * the others, and none of them can stop the core.
 *
 * @module @deepseek-ai/dsh-memory/src/integration
 */

/** One section an integration contributes to the hot pack. */
export interface HotPackSection {
  /** Section name, so the model can tell integrations apart. */
  name: string
  /** The rendered text. */
  content: string
  /** Byte budget this section is allowed. */
  budgetBytes: number
}

/** What an integration may offer the memory core. */
export interface Integration {
  /** Stable name. */
  name: string
  /** Version of the integration itself, not of the core. */
  version: string
  /**
   * Whether the tool this integrates with is present.
   *
   * Called once at load. Returning `false` means "not installed", which is a
   * normal outcome and not an error; throwing means "could not tell", which is
   * contained the same way.
   * @returns `true` when the integration should be used.
   */
  detect(): Promise<boolean>
  /**
   * Contribute a hot-pack section, when there is anything to contribute.
   * @param scope - The serialized scope the pack is built for.
   * @returns The section, or `null` to contribute nothing.
   */
  collectHotPackSection?(scope: string): Promise<HotPackSection | null>
  /**
   * Offer pattern evidence the core could not otherwise see.
   * @returns The evidence statements, or nothing.
   */
  collectPatternEvidence?(): Promise<string[]>
  /**
   * Write an approved pattern back into the tool's own store.
   * @param patternId - The approved pattern's id.
   * @param content - The pattern's text.
   * @returns resolution once written.
   */
  writePatternOnApproval?(patternId: string, content: string): Promise<void>
}

/** What one load attempt produced, for the log and the tests. */
export interface IntegrationLoadReport {
  /** Integrations that detected successfully. */
  active: Integration[]
  /** Names that were skipped, with the reason. */
  skipped: { name: string; reason: string }[]
}

/**
 * Whether a configuration asks for the toolkit integration to be a load
 * candidate.
 *
 * The three states differ on one axis — who decides. `auto` defers to
 * `autoDetect`, because "decide for me" is a different request from "I already
 * decided". `on` decides, and so it ignores auto-detect: a deployment that
 * knows the toolkit is there must not be overruled by a probe it just switched
 * off. `off` is the only state that keeps the integration out.
 * @param integrations - The resolved integration configuration.
 * @returns Whether the toolkit integration should be offered to the loader.
 */
export function toolkitIntegrationRequested(integrations: {
  readonly autoDetect: boolean
  readonly toolkit: { readonly enabled: 'auto' | 'on' | 'off' }
}): boolean {
  const { enabled } = integrations.toolkit
  if (enabled === 'on') return true
  if (enabled === 'off') return false
  return integrations.autoDetect
}

/**
 * Load every integration that detects successfully.
 *
 * A candidate that throws is recorded and skipped rather than propagated: the
 * caller asked "which integrations are available", and a tool that cannot
 * answer is simply unavailable. Nothing here can fail the plugin mount, which
 * is what makes the core independent of the integrations.
 * @param candidates - The integrations to probe, in order.
 * @returns The active integrations and what was skipped.
 */
export async function loadIntegrations(
  candidates: readonly Integration[],
): Promise<IntegrationLoadReport> {
  const active: Integration[] = []
  const skipped: { name: string; reason: string }[] = []
  for (const candidate of candidates) {
    try {
      if (await candidate.detect()) active.push(candidate)
      else skipped.push({ name: candidate.name, reason: 'not detected' })
    } catch (error) {
      skipped.push({ name: candidate.name, reason: String(error) })
    }
  }
  return { active, skipped }
}

/**
 * Collect every active integration's hot-pack section.
 *
 * One integration failing does not lose the others' sections: the section is
 * a nice-to-have on top of the core pack, so a failure degrades to "this
 * integration contributed nothing".
 * @param integrations - The active integrations.
 * @param scope - The serialized scope.
 * @returns The sections, in load order.
 */
export async function collectIntegrationSections(
  integrations: readonly Integration[],
  scope: string,
): Promise<HotPackSection[]> {
  const sections: HotPackSection[] = []
  for (const integration of integrations) {
    if (integration.collectHotPackSection === undefined) continue
    try {
      const section = await integration.collectHotPackSection(scope)
      if (section !== null && section.content.trim() !== '') sections.push(section)
    } catch {
      // Contained per integration; see the module note.
    }
  }
  return sections
}
