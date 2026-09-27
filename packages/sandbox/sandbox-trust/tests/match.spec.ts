/**
 * Behavior suite for @deepseek-ai/dsh-sandbox-trust/match: command-name
 * extraction across shell separators, canonicalization (case, executable
 * suffix), and the all-segments trusted-command rule — including the refusal
 * of a non-listed program chained after a separator, which is the safety point
 * of the whole feature.
 */

import { describe, expect, it } from 'vitest'
import { isTrustedCommand, normalizeCommandName, simpleCommandTokens } from '../src/match.ts'

describe('simpleCommandTokens', () => {
  it('takes the leading token of a single command', () => {
    expect(simpleCommandTokens('cargo build --release')).toEqual(['cargo'])
  })

  it('splits on &&, ||, ;, |, and line breaks', () => {
    expect(simpleCommandTokens('cd service && cargo build; gh pr list | head')).toEqual(['cd', 'cargo', 'gh', 'head'])
    expect(simpleCommandTokens('gh auth status || gh auth login')).toEqual(['gh', 'gh'])
  })

  it('returns an empty token for an empty segment, which callers drop', () => {
    expect(simpleCommandTokens('  &&  cargo build')).toEqual(['', 'cargo'])
  })

  it('splits a background run on its separator', () => {
    expect(simpleCommandTokens('serve & cargo build')).toEqual(['serve', 'cargo'])
  })
})

describe('normalizeCommandName', () => {
  it('lowercases and trims', () => {
    expect(normalizeCommandName('  Cargo ')).toBe('cargo')
  })

  it('drops a Windows executable suffix', () => {
    expect(normalizeCommandName('cargo.exe')).toBe('cargo')
    expect(normalizeCommandName('Run.CMD')).toBe('run')
  })

  it('leaves a non-suffix name alone and empties a bare suffix', () => {
    expect(normalizeCommandName('cargofoo')).toBe('cargofoo')
    expect(normalizeCommandName('.exe')).toBe('')
  })
})

describe('isTrustedCommand', () => {
  it('is never trusted by an empty list', () => {
    expect(isTrustedCommand('cargo build', [])).toBe(false)
  })

  it('is never trusted for an empty or whitespace-only source', () => {
    expect(isTrustedCommand('   ', ['cargo'])).toBe(false)
    expect(isTrustedCommand('', ['cargo'])).toBe(false)
  })

  it('trusts a single listed command', () => {
    expect(isTrustedCommand('cargo build --release', ['cargo'])).toBe(true)
  })

  it('matches case-insensitively and across the executable suffix', () => {
    expect(isTrustedCommand('Cargo.EXE build', ['cargo'])).toBe(true)
    expect(isTrustedCommand('gh pr create', ['GH'])).toBe(true)
  })

  it('requires every program in a chained command to be listed', () => {
    expect(isTrustedCommand('cd service && cargo build', ['cd', 'cargo'])).toBe(true)
    expect(isTrustedCommand('cd service && cargo build', ['cargo'])).toBe(false)
  })

  it('refuses a non-listed program chained after a separator', () => {
    expect(isTrustedCommand('cargo build; rm -rf /', ['cargo'])).toBe(false)
    expect(isTrustedCommand('cargo build | sh', ['cargo'])).toBe(false)
  })

  it('does not match a near-miss command name', () => {
    expect(isTrustedCommand('cargofoo build', ['cargo'])).toBe(false)
  })

  it('does not match through an environment-assignment prefix', () => {
    expect(isTrustedCommand('RUSTFLAGS=x cargo build', ['cargo'])).toBe(false)
  })
})
