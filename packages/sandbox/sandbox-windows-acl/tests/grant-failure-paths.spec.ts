/**
 * AclWriteGrant failure-path tests with minimal stub binding tables: create
 * fails closed on SID-parse failure,
 * dispose aggregates revocation and SID-free failures into an
 * AggregateError. Pure stubs — no real Win32 calls, so these run on every
 * platform; the real-FFI round-trip lives in grant.spec.ts (win32 only).
 */

import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import koffi from 'koffi'

import * as abi from '../src/win32-abi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import { Win32Error } from '../src/ffi.ts'
import { AclWriteGrant } from '../src/index.ts'

const PVOID = koffi.pointer('void')

/** Stub binding table: only the members a test drives, so the rest are never called. */
function stubBindings(overrides: Partial<Win32Bindings>): Win32Bindings {
  return overrides as Win32Bindings
}

/** The stub the grant-then-fail-revoke sequence needs: every call succeeds until the DACL read is flipped off. */
function grantThenFailApi(): { api: Win32Bindings; failReads: () => void } {
  const state = { failReads: false }
  const api = stubBindings({
    convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
      koffi.encode(slot, PVOID, 42n)
      return 1
    }),
    createWellKnownSid: vi.fn(() => 1),
    isValidSid: vi.fn(() => 1),
    getLengthSid: vi.fn(() => 12),
    localAlloc: vi.fn(() => 11n as NativePtr),
    initializeAcl: vi.fn(() => 1),
    addMandatoryAce: vi.fn(() => 1),
    getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
      const temp = tmpdir().endsWith('/') || tmpdir().endsWith('\\') ? tmpdir() : `${tmpdir()}/`
      buffer.write(temp, 'utf16le')
      return temp.length
    }),
    createFileW: vi.fn(() => 7n as NativePtr),
    lockFileEx: vi.fn(() => 1),
    unlockFileEx: vi.fn(() => 1),
    closeHandle: vi.fn(() => 1),
    getNamedSecurityInfoW: vi.fn((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      if (state.failReads) return 2 // ERROR_FILE_NOT_FOUND — the revoke's read fails
      koffi.encode(dacl, PVOID, 0n) // no explicit DACL: the merge builds one
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    }),
    setEntriesInAclW: vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, 9n)
      return 0
    }),
    setNamedSecurityInfoW: vi.fn(() => 0),
    localFree: vi.fn(() => 0n as NativePtr),
    getLastError: vi.fn(() => 2),
    formatMessageW: vi.fn(() => 0),
  })
  return { api, failReads: () => { state.failReads = true } }
}

/**
 * Owner-only stub: the directory names the caller as owner and carries no
 * explicit DACL, so the label edit (SACL) is denied per `deny` and every DACL
 * edit succeeds. Records each SetNamedSecurityInfoW security-info argument so
 * a test observes the denied grant, the DACL-only self-grant, and the retry.
 * @param deny - 'first' denies the first label edit only; 'always' denies
 *   every label edit; `code` replaces the denied error code for non-access-denied failures.
 */
function ownerOnlyApi(deny: 'first' | 'always' | { code: number }): { api: Win32Bindings; securityCalls: { info: number }[] } {
  const securityCalls: { info: number }[] = []
  let labelEdits = 0
  const api = stubBindings({
    convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
      koffi.encode(slot, PVOID, 42n)
      return 1
    }),
    createWellKnownSid: vi.fn(() => 1),
    isValidSid: vi.fn(() => 1),
    getLengthSid: vi.fn(() => 12),
    localAlloc: vi.fn(() => 11n as NativePtr),
    initializeAcl: vi.fn(() => 1),
    addMandatoryAce: vi.fn(() => 1),
    getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
      const temp = tmpdir().endsWith('/') || tmpdir().endsWith('\\') ? tmpdir() : `${tmpdir()}/`
      buffer.write(temp, 'utf16le')
      return temp.length
    }),
    createFileW: vi.fn(() => 7n as NativePtr),
    lockFileEx: vi.fn(() => 1),
    unlockFileEx: vi.fn(() => 1),
    closeHandle: vi.fn(() => 1),
    getNamedSecurityInfoW: vi.fn((
      _path: unknown, _type: unknown, _info: unknown, owner: NativePtr, _group: unknown,
      dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
    ) => {
      koffi.encode(owner, PVOID, 42n) // the caller owns the directory
      koffi.encode(dacl, PVOID, 0n)
      koffi.encode(sacl, PVOID, 0n)
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    }),
    setEntriesInAclW: vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, 9n)
      return 0
    }),
    setNamedSecurityInfoW: vi.fn((_path: unknown, _type: unknown, info: number) => {
      securityCalls.push({ info })
      if ((info & abi.LABEL_SECURITY_INFORMATION) === 0) return 0 // the DACL-only self-grant
      labelEdits += 1
      if (deny === 'always' || deny === 'first' && labelEdits === 1) return 5 // ERROR_ACCESS_DENIED
      if (typeof deny === 'object') return deny.code
      return 0
    }),
    localFree: vi.fn(() => 0n as NativePtr),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
  })
  return { api, securityCalls }
}

describe('AclWriteGrant failure paths', () => {
  it('create fails closed: a SID parse failure throws before anything is granted', () => {
    const api = {
      convertStringSidToSidW: vi.fn(() => 0),
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    expect(() => AclWriteGrant.create('S-1-4-abc-1', api)).toThrow(/ConvertStringSidToSidW/)
  })

  it('create fails closed: a null SID pointer is rejected', () => {
    const api = {
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 0n)
        return 1
      }),
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    expect(() => AclWriteGrant.create('S-1-4-42-42', api)).toThrow(/null SID/)
  })

  it('dispose aggregates a failing revocation into an AggregateError (best-effort cleanup)', () => {
    const { api, failReads } = grantThenFailApi()
    const grant = AclWriteGrant.create('S-1-4-42-42', api)
    grant.add('C:\\granted')
    expect(grant.paths).toEqual(['C:\\granted'])
    failReads()
    expect(() =>{  grant.dispose() }).toThrow(AggregateError)
  })

  it('dispose aggregates a failing SID free into an AggregateError', () => {
    const api = stubBindings({
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 42n)
        return 1
      }),
      createWellKnownSid: vi.fn(() => 1),
      isValidSid: vi.fn(() => 1),
      localFree: vi.fn(() => 1n as NativePtr), // non-NULL: LocalFree "failed"
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    })
    const grant = AclWriteGrant.create('S-1-4-42-42', api)
    expect(() =>{  grant.dispose() }).toThrow(AggregateError)
  })

  it('create fails closed when the Low label SID cannot be created', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    const api = stubBindings({
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 42n)
        return 1
      }),
      createWellKnownSid: vi.fn(() => 0),
      localFree,
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    })
    expect(() => AclWriteGrant.create('S-1-4-42-42', api)).toThrow(/CreateWellKnownSid/)
    expect(localFree).toHaveBeenCalledWith(42n) // the parsed capability SID is not stranded
  })

  it('create frees both earlier SIDs when the world SID cannot be created', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    let calls = 0
    const api = stubBindings({
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 42n)
        return 1
      }),
      createWellKnownSid: vi.fn(() => (++calls === 1 ? 1 : 0)), // the Low label SID succeeds, the world SID fails
      isValidSid: vi.fn(() => 1),
      localFree,
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    })
    expect(() => AclWriteGrant.create('S-1-4-42-42', api)).toThrow(/CreateWellKnownSid/)
    expect(localFree).toHaveBeenCalledTimes(2)
    expect(localFree).toHaveBeenCalledWith(42n)
  })

  it('add retries the grant after the WRITE_OWNER self-grant when the label edit is access denied', () => {
    const { api, securityCalls } = ownerOnlyApi('first')
    const grant = AclWriteGrant.create('S-1-4-9000-81', api)
    grant.add('C:\\granted')
    expect(grant.paths).toEqual(['C:\\granted'])
    // denied grant → DACL-only self-grant → retried grant with both information classes
    expect(securityCalls).toHaveLength(3)
    expect(securityCalls[1]?.info & abi.LABEL_SECURITY_INFORMATION).toBe(0)
    expect(securityCalls[2]?.info & abi.LABEL_SECURITY_INFORMATION).toBe(abi.LABEL_SECURITY_INFORMATION)
  })

  it('add propagates the access denied failure when the WRITE_OWNER self-grant is also refused', () => {
    const { api, securityCalls } = ownerOnlyApi('always')
    const grant = AclWriteGrant.create('S-1-4-9000-82', api)
    expect(() => grant.add('C:\\granted')).toThrow(Win32Error)
    // denied grant → granted DACL-only self-grant → denied retry, which propagates
    expect(securityCalls).toHaveLength(3)
    // The recorded path is revoked by dispose; the merge of an ungranted path is a no-op.
    grant.dispose()
  })

  it('add does not self-grant WRITE_OWNER on a non-access-denied grant failure', () => {
    const { api, securityCalls } = ownerOnlyApi({ code: 1307 }) // ERROR_INVALID_OWNER
    expect(() => AclWriteGrant.create('S-1-4-9000-83', api).add('C:\\granted')).toThrow(/Win32 1307/)
    expect(securityCalls).toHaveLength(1)
  })
})
