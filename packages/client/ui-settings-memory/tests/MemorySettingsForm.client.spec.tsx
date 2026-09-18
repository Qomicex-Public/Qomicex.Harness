// @vitest-environment jsdom
/**
 * The memory configuration form: it renders the resolved section, writes
 * through the settings face, and clears a field back to the composition layer.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettingsForm, readPath, userHasPath } from '../src/client/MemorySettingsForm.tsx'
import type { MemorySettingsFace, SettingsSnapshotView } from '../src/client/MemorySection.tsx'
import { en, zh as zhDict, type MemoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** The shipped English dictionary, so assertions read the real copy. */
const t = (key: MemoryLocaleKey): string => en[key]

/** No provider directory: the distillation dropdowns have nothing to offer. */
const noTargets = { providers: [] }

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
function face(options: { user?: unknown; value?: unknown; writable?: boolean; status?: SettingsSnapshotView['status'] } = {}) {
  const mutate = vi.fn(async () => {})
  const snapshot: SettingsSnapshotView = {
    status: options.status ?? 'ready',
    value: options.value ?? resolved,
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
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    expect(screen.getByLabelText('Write excitability threshold')).toHaveProperty('value', '0.45')
    expect(screen.getByLabelText('Recall top K')).toHaveProperty('value', '8')
    expect(screen.getByLabelText('Inject hot pack')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('Authorization plane')).toHaveProperty('checked', false)
  })

  it('writes a number field on blur as a path-addressed op', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    const input = screen.getByLabelText('Write excitability threshold')
    fireEvent.change(input, { target: { value: '0.6' } })
    fireEvent.blur(input, { target: { value: '0.6' } })

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['thresholds', 'excitability'], value: 0.6 }])
    })
  })

  it('writes a boolean field on change', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    fireEvent.click(screen.getByLabelText('Inject hot pack'))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['injection', 'hotPack'], value: false }])
    })
  })

  it('does not write a number the field cannot accept', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    const input = screen.getByLabelText('Write excitability threshold')
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input, { target: { value: '2' } })

    // Above the field's max: the draft stays local instead of writing a value
    // the Host schema would reject.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('clears a number field when the draft is emptied', async () => {
    const { settings, mutate } = face()
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

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
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    const input = screen.getByLabelText('Distill provider')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['llmDistill', 'provider'] }])
    })
  })

  it('offers a reset only for a field the user layer carries', () => {
    const untouched = face({ user: {} })
    const { unmount } = render(<MemorySettingsForm settings={untouched.settings} t={t} distillTargets={noTargets} />)
    expect(screen.queryAllByText('Reset')).toHaveLength(0)
    unmount()

    const touched = face({ user: { thresholds: { excitability: 0.5 } } })
    render(<MemorySettingsForm settings={touched.settings} t={t} distillTargets={noTargets} />)
    expect(screen.getAllByText('Reset')).toHaveLength(1)
  })

  it('resets through an unset op', async () => {
    const { settings, mutate } = face({ user: { thresholds: { excitability: 0.5 } } })
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    fireEvent.click(screen.getByText('Reset'))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['thresholds', 'excitability'] }])
    })
  })

  it('disables every control when the document is read-only', () => {
    const { settings } = face({ writable: false })
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    expect(screen.getByLabelText('Write excitability threshold')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Inject hot pack')).toHaveProperty('disabled', true)
  })

  it('reports a refused write', async () => {
    const { settings, mutate } = face()
    mutate.mockRejectedValueOnce(new Error('read-only deployment'))
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

    fireEvent.click(screen.getByLabelText('Inject hot pack'))

    await waitFor(() => {
      expect(screen.getByText(/read-only deployment/)).toBeTruthy()
    })
  })

  it('reports an unavailable namespace', () => {
    const { settings } = face({ status: 'unavailable' })
    render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)
    expect(screen.getByText('No settings service is mounted in this deployment.')).toBeTruthy()
  })

  it('renders the field labels and hints in the active language', () => {
    // Every control is named through the dictionary, so a Chinese user reads
    // what each knob does rather than an English-only form.
    const zh = (key: MemoryLocaleKey): string => zhDict[key]
    const { settings } = face()
    render(<MemorySettingsForm settings={settings} t={zh} distillTargets={noTargets} />)

    expect(screen.getByLabelText(zhDict['field.excitability.label'])).toBeTruthy()
    expect(screen.getByText(zhDict['field.excitability.hint'])).toBeTruthy()
    expect(screen.getByLabelText(zhDict['field.distillModel.label'])).toBeTruthy()
    // The hint is appended with the no-models prompt when the directory is
    // empty, so it is matched as a prefix rather than as a whole element.
    expect(screen.getByText(new RegExp(`^${zhDict['field.distillModel.hint']}`))).toBeTruthy()
    // The Chinese copy must actually differ from the English one, or the test
    // would pass on a form that ignored its dictionary.
    expect(zhDict['field.excitability.label']).not.toBe(en['field.excitability.label'])
  })

  it('covers every field with a label and a hint in both languages', () => {
    // A field added without copy would otherwise render its raw key.
    for (const key of Object.keys(en) as MemoryLocaleKey[]) {
      if (!key.startsWith('field.')) continue
      expect(zhDict[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  describe('distillation dropdowns', () => {
    const targets = {
      providers: [
        { provider: 'deepseek', displayName: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
        { provider: 'openai', displayName: 'OpenAI', models: [] },
      ],
    }

    const providerSelect = () => screen.getByLabelText<HTMLSelectElement>(en['field.distillProvider.label'])
    const modelSelect = () => screen.getByLabelText<HTMLSelectElement>(en['field.distillModel.label'])

    it('offers the configured providers', () => {
      const { settings } = face()
      render(<MemorySettingsForm settings={settings} t={t} distillTargets={targets} />)

      const options = Array.from(providerSelect().options).map(option => option.value)
      expect(options).toContain('deepseek')
      // Options carry the provider's display name but write its id.
      expect(providerSelect().querySelector('option[value="openai"]')?.textContent).toBe('OpenAI')
    })

    it('lists the models of the selected provider', () => {
      const { settings } = face({ value: { ...resolved, llmDistill: { enabled: false, provider: 'deepseek', model: '' } } })
      render(<MemorySettingsForm settings={settings} t={t} distillTargets={targets} />)

      expect(modelSelect().disabled).toBe(false)
      expect(Array.from(modelSelect().options).map(option => option.value)).toContain('deepseek-chat')
    })

    it('disables the model list when the selected provider has no models', () => {
      const { settings } = face({ value: { ...resolved, llmDistill: { enabled: false, provider: 'openai', model: '' } } })
      render(<MemorySettingsForm settings={settings} t={t} distillTargets={targets} />)

      expect(modelSelect().disabled).toBe(true)
    })

    it('disables both dropdowns when no provider is configured', () => {
      const { settings } = face()
      render(<MemorySettingsForm settings={settings} t={t} distillTargets={noTargets} />)

      expect(providerSelect().disabled).toBe(true)
      expect(modelSelect().disabled).toBe(true)
    })

    it('writes the chosen provider as a path-addressed op', async () => {
      const { settings, mutate } = face()
      render(<MemorySettingsForm settings={settings} t={t} distillTargets={targets} />)

      fireEvent.change(providerSelect(), { target: { value: 'deepseek' } })

      await waitFor(() => {
        expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['llmDistill', 'provider'], value: 'deepseek' }])
      })
    })
  })
})
