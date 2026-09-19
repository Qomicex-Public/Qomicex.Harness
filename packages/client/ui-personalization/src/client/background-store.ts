/**
 * Browser-local image storage for the Personalization page. Uploaded images are
 * Blobs that must not enter the Host settings document, so they live in
 * IndexedDB under stable keys; the settings document records only which key is
 * in use. Every read resolves `undefined` rather than throwing when IndexedDB
 * is unavailable (a storeless run, or a locked/blocked database), so a caller
 * can fall back to no image.
 *
 * @module @deepseek-ai/dsh-client-ui-personalization/background-store
 */

/** Database holding the uploaded image Blobs. */
const DATABASE_NAME = 'dsh-personalization'

/** Object store inside {@link DATABASE_NAME}. */
const STORE_NAME = 'images'

/** Key of the uploaded background image. */
export const BACKGROUND_IMAGE_KEY = 'background'

/** Key of the uploaded corner decoration image. */
export const CORNER_IMAGE_KEY = 'corner'

/** Open the images database, creating the object store on first use. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('personalization: IndexedDB open failed')) }
  })
}

/** Whether this environment exposes IndexedDB at all. */
function available(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Store one image Blob under a key, replacing any previous value.
 * @param key - one of the exported image keys.
 * @param blob - the image bytes to store.
 * @returns a promise settling when the write commits.
 * @throws when IndexedDB is unavailable or the write fails.
 */
export async function putImage(key: string, blob: Blob): Promise<void> {
  if (!available()) throw new Error('personalization: IndexedDB is unavailable in this environment')
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(blob, key)
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { reject(transaction.error ?? new Error('personalization: IndexedDB write failed')) }
    transaction.onabort = () => { reject(transaction.error ?? new Error('personalization: IndexedDB write aborted')) }
  })
  database.close()
}

/**
 * Read one stored image.
 * @param key - one of the exported image keys.
 * @returns the stored Blob, or `undefined` when absent or IndexedDB is unavailable.
 */
export async function getImage(key: string): Promise<Blob | undefined> {
  if (!available()) return undefined
  let database: IDBDatabase
  try {
    database = await openDatabase()
  } catch {
    // A blocked or unavailable database is the same outcome as a missing image.
    return undefined
  }
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => { resolve(request.result instanceof Blob ? request.result : undefined) }
      request.onerror = () => { reject(request.error ?? new Error('personalization: IndexedDB read failed')) }
    })
  } catch {
    return undefined
  } finally {
    database.close()
  }
}

/**
 * Remove one stored image. Absent keys and an unavailable IndexedDB are no-ops.
 * @param key - one of the exported image keys.
 * @returns a promise settling when the delete commits.
 */
export async function deleteImage(key: string): Promise<void> {
  if (!available()) return
  let database: IDBDatabase
  try {
    database = await openDatabase()
  } catch {
    return
  }
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { resolve() }
    transaction.onabort = () => { resolve() }
  })
  database.close()
}
