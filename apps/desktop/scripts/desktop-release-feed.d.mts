/** Environment variable naming the GitHub repository that publishes releases. */
export const DESKTOP_GITHUB_REPOSITORY_ENV: 'DSH_DESKTOP_GITHUB_REPOSITORY'

/** One GitHub owner and repository name. */
export interface GithubRepository {
  readonly owner: string
  readonly repo: string
}

/**
 * Read the GitHub repository that publishes this build's release feed.
 * @param value - Raw environment value; empty selects no GitHub feed.
 * @returns The parsed repository, or `undefined` when unset.
 */
export declare function parseDesktopGithubRepository(value: string | undefined): GithubRepository | undefined

/**
 * Resolve the electron-builder publish providers for one build.
 * @param env - Packaging environment.
 * @param selectors - Signing state and the packaged target.
 * @returns Publish provider entries, or `undefined` when this build has no feed.
 */
export declare function resolveDesktopReleaseFeed(
  env: NodeJS.ProcessEnv,
  selectors: {
    readonly unsigned: boolean
    readonly platform: NodeJS.Platform
    readonly arch: NodeJS.Arch
  },
): readonly Record<string, unknown>[] | undefined
