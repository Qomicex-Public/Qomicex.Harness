/** dsh-market: the external dshmarket plugin as a browser row of the real web roster. */
import { describe, expect, it } from 'vitest'
import { webApp } from '../src/assembly/bundle-roster.ts'

describe('dsh-market in the real web roster', () => {
  it('carries dshmarket as a browser row with its declared inject cone', () => {
    const row = webApp.rows.find(candidate => candidate.name === 'dshmarket')
    expect(row).toBeDefined()
    expect(row?.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-theme',
    ])
  })

  it('resolves dshmarket from the web-app bundle with every inject target on the roster', () => {
    const names = new Set(webApp.rows.map(row => row.name))
    for (const target of [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-theme',
    ]) {
      expect(names.has(target)).toBe(true)
    }
  })
})
