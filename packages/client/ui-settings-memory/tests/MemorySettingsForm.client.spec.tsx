// @vitest-environment jsdom
/**
 * The memory configuration form: it renders the resolved section, writes
 * through the settings face, and clears a field back to the composition layer.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettingsForm, readPath, userHasPath } from '../src/client/MemorySettingsForm.tsx'
import type { MemorySettingsFace, SettingsSnapshotView } from '../src/client/MemorySection.tsx'

afterEach(cleanup)

const labels = { reset: 'Reset', saved: 'Saved.', failed: 'Save failed: ', unavailable: 'Not available.' }

/** A resolved section with the defaults the schema would produce. */
const resolved = {
  thresholds: { excitability: 0.45, forgetDemote: 0.45, forgetArchive: 0.65, forgetHard: 0.85 },
  bounds: { workingCapacity: 7, stagingCapacity: 32 },
  retrieval: { topK: 8, similarityThreshold: 0.3, useVector: false },
  injection: { hotPack: true, recallMaxChars: 2000 },
  authorization: { enabled: false, policyVersion: 'bio-memory-1' },
  llmDistill: { enabled: false, provider: '', model: '' },
}

/** Build a settings face over a fixed snapshot, recording every mutate. */
function face(options: { user?: unknown; writable?: boolean; status?: SettingsSnapshotView['status'] } = {}) {
  const mutate = vi.fn(async () => {})
  const snapshot: SettingsSnapshotView = {
    status: options.status ?? 'ready',
    value: resolved,
    user: options.user ?? {},
    writable: options.writable ?? true,
    revision: 1,
  }
  const settings: MemorySettingsFace = {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    mutate,
  }
  return { settings, mutate }
}

describe('readPath', () => {
  it('reads a nested value', () => {
    expect(readPath(resolved, ['thresholds', 'excitability'])).toBe(0.45)
  })

  it('returns undefined for a missing path without throwing', () => {
    expect(readPath(resolved, ['nope', 'deeper'])).toBeUndefined()
    expect(readPath(undefined, ['thresholds'])).toBeUndefined()
    expect(readPath(resolved, ['thresholds', 'excitability', 'tooDeep'])).toBeUndefined()
  })
})

describe('userHasPath', () => {
  it('reports a path the user layer carries', () => {
    expect(userHasPath({ thresholds: { excitability: 0.5 } }, ['thresholds', 'excitability'])).toBe(true)
  })

  it('reports a path the user layer does not carry', () => {
    expect(userHasPath({ thresholds: {} }, ['thresholds', 'excitability'])).toBe(false)
    expect(userHasPath(undefined, ['thresholds'])).toBe(false)
  })

  it('treats an explicit undefined as absent', () => {
    expect(userHasPath({ thresholds: { excitability: undefined } }, ['thresholds', 'excitability'])).toBe(false)
  })
})

describe('MemorySettingsForm', () => {
  it('renders the resolved values', () => {
    const { settings } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    expect(screen.getByLabelText('Excitability threshold')).toHaveProperty('value', '0.45')
    expect(screen.getByLabelText('Recall top K')).toHaveProperty('value', '8')
    expect(screen.getByLabelText('Inject hot pack')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Authorization plane')).toHaveProperty('checked', false)
  })

  it('writes a number field on blur as a path-addressed op', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    const input = screen.getByLabelText('Excitability threshold')
    fireEvent.change(input, { target: { value: '0.6' } })
    fireEvent.blur(input, { target: { value: '0.6' } })

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['thresholds', 'excitability'], value: 0.6 }])
    })
  })

  it('writes a boolean field on change', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    fireEvent.click(screen.getByLabelText('Inject hot pack'))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['injection', 'hotPack'], value: false }])
    })
  })

  it('does not write a number the field cannot accept', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    const input = screen.getByLabelText('Excitability threshold')
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input, { target: { value: '2' } })

    // Above the field's max: the draft stays local instead of writing a value
    // the Host schema would reject.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('clears a number field when the draft is emptied', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    const input = screen.getByLabelText('Recall top K')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })

    // A number input cannot hold non-numeric text (the browser blanks it), so
    // an emptied control is the only "no value" gesture it can produce, and it
    // means the same as reset: revert to the composition layer.
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['retrieval', 'topK'] }])
    })
  })

  it('clears a field with an unset op when the draft is emptied', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    const input = screen.getByLabelText('Distill provider')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['llmDistill', 'provider'] }])
    })
  })

  it('offers a reset only for a field the user layer carries', () => {
    const untouched = face({ user: {} })
    const { unmount } = render(<MemorySettingsForm settings={untouched.settings} labels={labels} />)
    expect(screen.queryAllByText('Reset')).toHaveLength(0)
    unmount()

    const touched = face({ user: { thresholds: { excitability: 0.5 } } })
    render(<MemorySettingsForm settings={touched.settings} labels={labels} />)
    expect(screen.getAllByText('Reset')).toHaveLength(1)
  })

  it('resets through an unset op', async () => {
    const { settings, mutate } = face({ user: { thresholds: { excitability: 0.5 } } })
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    fireEvent.click(screen.getByText('Reset'))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['thresholds', 'excitability'] }])
    })
  })

  it('disables every control when the document is read-only', () => {
    const { settings } = face({ writable: false })
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    expect(screen.getByLabelText('Excitability threshold')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Inject hot pack')).toHaveProperty('disabled', true)
  })

  it('reports a refused write', async () => {
    const { settings, mutate } = face()
    mutate.mockRejectedValueOnce(new Error('read-only deployment'))
    render(<MemorySettingsForm settings={settings} labels={labels} />)

    fireEvent.click(screen.getByLabelText('Inject hot pack'))

    await waitFor(() => {
      expect(screen.getByText(/read-only deployment/)).toBeTruthy()
    })
  })

  it('reports an unavailable namespace', () => {
    const { settings } = face({ status: 'unavailable' })
    render(<MemorySettingsForm settings={settings} labels={labels} />)
    expect(screen.getByText('Not available.')).toBeTruthy()
  })
})
