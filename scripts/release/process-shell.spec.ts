/** Shell forwarding for the release process helpers. */

import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { attempt, capture } from './process.ts'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: 'out', stderr: '' })),
}))

afterEach(() => {
  vi.mocked(spawnSync).mockClear()
})

it('forwards the shell option a Windows batch shim needs', () => {
  attempt('pnpm', ['install', '--lockfile-only'], { shell: true })
  expect(spawnSync).toHaveBeenCalledWith(
    'pnpm',
    ['install', '--lockfile-only'],
    expect.objectContaining({ shell: true }),
  )
})

it('keeps a shell-free gate shell-free', () => {
  expect(capture('git', ['tag', '--list', 'dsh-v*'])).toBe('out')
  expect(spawnSync).toHaveBeenCalledWith(
    'git',
    ['tag', '--list', 'dsh-v*'],
    expect.objectContaining({ shell: undefined }),
  )
})
