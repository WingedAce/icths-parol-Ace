// Uploaded drawings are stored here instead of localStorage.
//
// Why: localStorage caps out around 5-10MB total per browser, and a single
// upscaled PNG drawing easily takes multiple MB once base64-encoded. Once a
// couple of real groups' drawings were saved, the very next localStorage
// write went over quota and threw QuotaExceededError — inside a React
// effect, which crashed the whole app to a blank white screen instead of
// failing quietly. IndexedDB has no such practical limit for this project's
// scale, so image data lives here now; localStorage keeps only the small
// stuff (zones, pin mappings, the workspace tree).

const DB_NAME = "parol-editor-images";
const STORE_NAME = "images";
const DB_VERSION = 1;

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveImage(id: string, dataUrl: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(dataUrl, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Loaded once on app start to hydrate images back onto their nodes, since
// IndexedDB access is async (unlike the old synchronous localStorage read).
export async function loadAllImages(): Promise<Record<string, string>> {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const result: Record<string, string> = {};
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        result[cursor.key as string] = cursor.value as string;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    request.onerror = () => reject(request.error);
  });
}
