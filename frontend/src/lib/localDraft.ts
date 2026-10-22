// A small copy of the user's work kept in THIS browser (IndexedDB), so nothing
// is lost if the internet drops, the cloud save fails, or the tab is closed
// before a save finishes. The cloud (Supabase) stays the real home of the
// project: this is only a safety net that is cleared as soon as the cloud has
// the same data, and it is used to restore anything the cloud never received.
//
// Everything here is best-effort. If IndexedDB is missing or blocked (private
// windows in some browsers), every call quietly does nothing.

const DB_NAME = "parol-local";
const STORE = "kv";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

export async function localGet<T>(key: string): Promise<T | undefined> {
  try {
    const database = await db();
    if (!database) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function localSet(key: string, value: unknown): Promise<void> {
  try {
    const database = await db();
    if (!database) return;
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } catch {
    // best-effort only
  }
}

export async function localDelete(key: string): Promise<void> {
  try {
    const database = await db();
    if (!database) return;
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } catch {
    // best-effort only
  }
}
