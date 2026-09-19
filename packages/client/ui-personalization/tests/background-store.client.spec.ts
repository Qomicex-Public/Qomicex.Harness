/**
 * Browser-local image storage: a minimal in-memory IndexedDB fake exercises the
 * put/get/delete round trip, the storeless fallbacks, and every failure path
 * the store treats as a missing image.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_IMAGE_KEY, CORNER_IMAGE_KEY, deleteImage, getImage, putImage,
} from '../src/client/background-store.ts'

/** Switches the fake consults to force each failure path for one test. */
const control = {
  openFails: false,
  openError: null as Error | null,
  requestFails: false,
  requestError: null as Error | null,
  txFails: false,
  txError: null as Error | null,
  txAborts: false,
}

/** One IndexedDB request; only the fields the store touches exist. */
class FakeRequest {
  result: unknown
  error: Error | null = null
  onsuccess: (() => void) | undefined
  onerror: (() => void) | undefined
  onupgradeneeded: (() => void) | undefined
}

/** The object store operations the store calls. */
class FakeStore {
  constructor(private readonly tx: FakeTransaction, private readonly rows: Map<string, unknown>) {}

  put(value: unknown, key: string): void {
    this.rows.set(key, value)
    this.tx.complete()
  }

  get(key: string): FakeRequest {
    const request = new FakeRequest()
    const value = this.rows.get(key)
    queueMicrotask(() => {
      if (control.requestFails) {
        request.error = control.requestError
        request.onerror?.()
        return
      }
      request.result = value
      request.onsuccess?.()
    })
    return request
  }

  delete(key: string): void {
    this.rows.delete(key)
    this.tx.complete()
  }
}

/** A transaction whose completion is deferred so the store can attach handlers first. */
class FakeTransaction {
  readonly store: FakeStore
  error: Error | null = null
  oncomplete: (() => void) | undefined
  onerror: (() => void) | undefined
  onabort: (() => void) | undefined

  constructor(rows: Map<string, unknown>) {
    this.store = new FakeStore(this, rows)
  }

  objectStore(_name: string): FakeStore {
    return this.store
  }

  complete(): void {
    queueMicrotask(() => {
      if (control.txFails) {
        this.error = control.txError
        this.onerror?.()
        return
      }
      if (control.txAborts) {
        this.error = control.txError
        this.onabort?.()
        return
      }
      this.oncomplete?.()
    })
  }
}

/** A database holding one map per object store. */
class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>()

  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: name => this.stores.has(name) }
  }

  createObjectStore(name: string): void {
    this.stores.set(name, new Map())
  }

  transaction(name: string): FakeTransaction {
    const rows = this.stores.get(name)
    if (rows === undefined) throw new Error(`fake indexedDB: no object store ${name}`)
    return new FakeTransaction(rows)
  }

  close(): void {}
}

/** The databases the fake has opened, keyed by name. */
const databases = new Map<string, FakeDatabase>()

/** The fake `indexedDB` factory the store opens through. */
const fakeIndexedDB = {
  open: (name: string): FakeRequest => {
    const request = new FakeRequest()
    queueMicrotask(() => {
      if (control.openFails) {
        request.error = control.openError
        request.onerror?.()
        return
      }
      let database = databases.get(name)
      if (database === undefined) {
        database = new FakeDatabase()
        databases.set(name, database)
      }
      request.result = database
      // A real open fires upgrade before success; the store creates its object
      // store on the first open and skips it once the store exists.
      request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  },
}

beforeEach(() => {
  control.openFails = false
  control.openError = null
  control.requestFails = false
  control.requestError = null
  control.txFails = false
  control.txError = null
  control.txAborts = false
  databases.clear()
  vi.stubGlobal('indexedDB', fakeIndexedDB)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storeless environments', () => {
  it('throws on write and no-ops on read and delete without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow(/unavailable/)
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
    await expect(deleteImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
  })
})

describe('image round trip', () => {
  it('stores, reads, and removes a blob, reusing an existing object store', async () => {
    const blob = new Blob(['image-bytes'])
    await putImage(BACKGROUND_IMAGE_KEY, blob)
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBe(blob)
    await putImage(CORNER_IMAGE_KEY, blob)
    await expect(getImage(CORNER_IMAGE_KEY)).resolves.toBe(blob)
    await deleteImage(BACKGROUND_IMAGE_KEY)
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
  })

  it('returns undefined for a stored value that is not a blob', async () => {
    await putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))
    databases.get('dsh-personalization')!.stores.get('images')!.set(BACKGROUND_IMAGE_KEY, 'not-a-blob')
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
  })
})

describe('failure paths', () => {
  it('rejects a write when opening the database fails, with and without a cause', async () => {
    control.openFails = true
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow(/open failed/)
    control.openError = new Error('blocked')
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow('blocked')
  })

  it('rejects a write on transaction error and on abort', async () => {
    control.txFails = true
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow(/write failed/)
    control.txError = new Error('quota')
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow('quota')
    control.txFails = false
    control.txAborts = true
    control.txError = null
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow(/write aborted/)
    control.txError = new Error('abort-cause')
    await expect(putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))).rejects.toThrow('abort-cause')
  })

  it('treats an open or read failure as a missing image', async () => {
    control.openFails = true
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
    control.openFails = false
    await putImage(BACKGROUND_IMAGE_KEY, new Blob(['x']))
    control.requestFails = true
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
    control.requestError = new Error('read-cause')
    await expect(getImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
  })

  it('swallows delete failures and an open failure', async () => {
    control.openFails = true
    await expect(deleteImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
    control.openFails = false
    control.txFails = true
    await expect(deleteImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
    control.txFails = false
    control.txAborts = true
    await expect(deleteImage(BACKGROUND_IMAGE_KEY)).resolves.toBeUndefined()
  })
})
