/** Update-feed selection for the packaged Desktop application. */

import { describe, expect, it } from 'vitest'
import {
  DESKTOP_GITHUB_REPOSITORY_ENV,
  parseDesktopGithubRepository,
  resolveDesktopReleaseFeed,
} from '../scripts/desktop-release-feed.mjs'

const GITHUB_REPOSITORY = 'Qomicex-Public/Qomicex.Harness'
const WIN = { unsigned: true, platform: 'win32', arch: 'x64' } as const

describe('desktop github repository', () => {
  it('parses an owner/repo pair and treats empty as unset', () => {
    expect(parseDesktopGithubRepository(GITHUB_REPOSITORY)).toEqual({ owner: 'Qomicex-Public', repo: 'Qomicex.Harness' })
    expect(parseDesktopGithubRepository(undefined)).toBeUndefined()
    expect(parseDesktopGithubRepository('   ')).toBeUndefined()
  })

  it('rejects anything that is not one owner/repo pair', () => {
    for (const value of [
      'Qomicex-Public',
      'Qomicex-Public/',
      '/Qomicex.Harness',
      'Qomicex-Public/Qomicex.Harness/extra',
      'https://github.com/Qomicex-Public/Qomicex.Harness',
      'Qomicex Public/Qomicex.Harness',
    ]) {
      expect(() => parseDesktopGithubRepository(value), value).toThrow(/owner\/repo/u)
    }
  })
})

describe('desktop release feed', () => {
  it('publishes the GitHub feed when a repository is configured', () => {
    expect(resolveDesktopReleaseFeed({ [DESKTOP_GITHUB_REPOSITORY_ENV]: GITHUB_REPOSITORY }, WIN)).toEqual([
      { provider: 'github', owner: 'Qomicex-Public', repo: 'Qomicex.Harness' },
    ])
  })

  it('keeps the GitHub feed for a signed build as well', () => {
    expect(resolveDesktopReleaseFeed(
      { [DESKTOP_GITHUB_REPOSITORY_ENV]: GITHUB_REPOSITORY },
      { unsigned: false, platform: 'darwin', arch: 'arm64' },
    )).toEqual([{ provider: 'github', owner: 'Qomicex-Public', repo: 'Qomicex.Harness' }])
  })

  it('publishes no feed for an unsigned build without a repository', () => {
    expect(resolveDesktopReleaseFeed({}, WIN)).toBeUndefined()
  })

  it('keeps the upstream COS feed for a signed build without a repository', () => {
    expect(resolveDesktopReleaseFeed(
      { DOWNLOAD_TEST_ORIGIN: 'https://download.example.com' },
      { unsigned: false, platform: 'darwin', arch: 'arm64' },
    )).toEqual([{ provider: 'generic', url: 'https://download.example.com/_/harness/desktop/stable/mac-arm64/' }])
  })

  it('rejects a malformed repository before packaging starts', () => {
    expect(() => resolveDesktopReleaseFeed({ [DESKTOP_GITHUB_REPOSITORY_ENV]: 'Qomicex-Public' }, WIN))
      .toThrow(/owner\/repo/u)
  })
})
