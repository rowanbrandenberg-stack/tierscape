/** Site photos live in IndexedDB: they are too large for localStorage and are never part of undo history. */
const DB = "tierscape";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((ok, no) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
}

export const putPhoto = (id: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, id));
export const getPhoto = (id: string) => tx<Blob | undefined>("readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>);
export const deletePhoto = (id: string) => tx("readwrite", (s) => s.delete(id));
