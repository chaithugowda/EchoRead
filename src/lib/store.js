/**
 * Local storage for the library.
 *
 * IndexedDB rather than localStorage, for two reasons that both bite at book
 * length: localStorage caps out around five megabytes, and it is synchronous,
 * so writing a parsed book would freeze the page mid-sentence.
 *
 * Documents and reading positions live in separate stores. A document record
 * holds every block of text and can run to hundreds of kilobytes; a position
 * is a single number that changes every few seconds. Keeping them apart means
 * following along does not rewrite the whole book each time.
 */

const DB_NAME = 'echoread'
const DB_VERSION = 1
const DOCS = 'docs'
const MARKS = 'marks'

let connection = null

function open() {
  if (connection) return connection

  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(MARKS)) {
        db.createObjectStore(MARKS, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return connection
}

/**
 * Run one transaction and resolve with its result.
 *
 * Every caller hands back the IDBRequest it made, and the value is read only
 * once the transaction commits. Reading `request.result` directly matters when
 * a lookup finds nothing: the result is `undefined`, and any attempt to fall
 * back to a default here would hand the caller the request object instead,
 * which is truthy and passes every "did we find it" check.
 */
function run(storeName, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const request = work(tx.objectStore(storeName))
        tx.oncomplete = () => resolve(request ? request.result : undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export function newId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Save a parsed document.
 *
 * Only the extracted blocks are kept, never the original file. A twenty
 * megabyte PDF reduces to a couple of hundred kilobytes of text, so a library
 * of fifty documents stays comfortably small — and re-reading the source file
 * would mean asking for it again on every visit, which browsers do not allow.
 */
export async function saveDoc({ id, title, blocks, words, format }) {
  const record = {
    id: id ?? newId(),
    title,
    blocks,
    words,
    format: format ?? 'text',
    addedAt: Date.now(),
    openedAt: Date.now(),
  }
  await run(DOCS, 'readwrite', (store) => store.put(record))
  return record
}

export function listDocs() {
  return run(DOCS, 'readonly', (store) => store.getAll()).then((docs) =>
    docs.sort((a, b) => b.openedAt - a.openedAt),
  )
}

export function getDoc(id) {
  return run(DOCS, 'readonly', (store) => store.get(id))
}

export async function touchDoc(id) {
  const doc = await getDoc(id)
  if (!doc) return
  doc.openedAt = Date.now()
  await run(DOCS, 'readwrite', (store) => store.put(doc))
}

export async function renameDoc(id, title) {
  const doc = await getDoc(id)
  if (!doc) return
  doc.title = title
  await run(DOCS, 'readwrite', (store) => store.put(doc))
}

export async function deleteDoc(id) {
  await run(DOCS, 'readwrite', (store) => store.delete(id))
  await run(MARKS, 'readwrite', (store) => store.delete(id))
}

/**
 * Reading positions, stored as a character offset.
 *
 * Deliberately not a word number. Word numbering depends on how the parser
 * split the text, so improving the parser in a later phase would silently
 * move every saved position in the library. A character offset into the text
 * survives that far better, and lands on the right sentence even if it drifts
 * by a word.
 */
export function saveMark(id, offset, fraction) {
  return run(MARKS, 'readwrite', (store) =>
    store.put({ id, offset, fraction, at: Date.now() }),
  )
}

export function getMark(id) {
  return run(MARKS, 'readonly', (store) => store.get(id))
}

export function listMarks() {
  return run(MARKS, 'readonly', (store) => store.getAll())
}

/**
 * Ask the browser not to evict this data.
 *
 * Without it, storage is "best effort" and can be cleared when the device runs
 * short of space — losing a book you were halfway through, with no warning.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted?.()) return true
  return navigator.storage.persist()
}

export async function usage() {
  if (!navigator.storage?.estimate) return null
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate()
  return { used, quota }
}
