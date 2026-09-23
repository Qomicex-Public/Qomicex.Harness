/** Node half: the package's only Host-side export is the plugin name and an
 * apply that registers nothing. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, name } from '../src/index.ts'

describe('ui-settings-web host half', () => {
  it('exposes the loader name and an apply that registers nothing', async () => {
    expect(name).toBe('ui-settings-web')
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    await fiber.dispose()
  })
})
