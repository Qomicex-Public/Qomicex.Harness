/** Resolve the Desktop update feed for one packaging environment. */

import { resolveDesktopAutoUpdateConfig } from './desktop-auto-update-environment.mjs'

/** Environment variable naming the GitHub repository that publishes releases. */
export const DESKTOP_GITHUB_REPOSITORY_ENV = 'DSH_DESKTOP_GITHUB_REPOSITORY'

/**
 * One GitHub owner and repository name.
 * @typedef {{ readonly owner: string, readonly repo: string }} GithubRepository
 */

const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_.]*\/[A-Za-z0-9][A-Za-z0-9-_.]*$/u

/**
 * Read the GitHub repository that publishes this build's release feed.
 *
 * @param {string | undefined} value - raw environment value; empty selects no GitHub feed.
 * @returns {GithubRepository | undefined} the parsed repository, or `undefined` when unset.
 * @throws {Error} When the value is not one `owner/repo` pair.
 */
export function parseDesktopGithubRepository(value) {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  if (!REPOSITORY_PATTERN.test(trimmed)) {
    throw new Error(`desktop release feed: ${DESKTOP_GITHUB_REPOSITORY_ENV} must be an owner/repo pair, got ${JSON.stringify(value)}`)
  }
  const separator = trimmed.indexOf('/')
  return { owner: trimmed.slice(0, separator), repo: trimmed.slice(separator + 1) }
}

/**
 * Resolve the electron-builder publish providers for one build.
 *
 * A GitHub repository publishes the release feed the application updates from.
 * Without it, a signed build keeps the upstream COS feed and an unsigned build
 * publishes none: the packaged application then carries no `app-update.yml`,
 * which is what disables its update checks.
 *
 * @param {NodeJS.ProcessEnv} env - packaging environment.
 * @param {{ readonly unsigned: boolean, readonly platform: NodeJS.Platform, readonly arch: NodeJS.Arch }} selectors - signing state and the packaged target.
 * @returns {readonly Record<string, unknown>[] | undefined} publish provider entries, or `undefined` when this build has no feed.
 */
export function resolveDesktopReleaseFeed(env, selectors) {
  const repository = parseDesktopGithubRepository(env[DESKTOP_GITHUB_REPOSITORY_ENV])
  if (repository !== undefined) {
    return [{ provider: 'github', owner: repository.owner, repo: repository.repo }]
  }
  if (selectors.unsigned) return undefined
  return [{ provider: 'generic', url: resolveDesktopAutoUpdateConfig(env, selectors.platform, selectors.arch).publicUrl }]
}
