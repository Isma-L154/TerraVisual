/**
 * Keeps the workspace between visits, in IndexedDB: a workspace can exceed
 * localStorage's quota, and localStorage blocks the main thread. Everything
 * degrades instead of throwing, so private browsing or a full disk costs
 * persistence and never the editor.
 */

const DATABASE = 'terravisual';
const STORE = 'workspace';
const KEY = 'current';
const VERSION = 1;

type StoredWorkspace = {
  files: Record<string, string>;
  savedAt: number;
};

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A permission prompt can otherwise leave this pending forever.
    request.onblocked = () => resolve(null);
  });
}

/** Returns whether the workspace was actually stored. */
export async function save(files: Record<string, string>): Promise<boolean> {
  const db = await open();
  if (!db) return false;

  try {
    return await new Promise<boolean>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction
        .objectStore(STORE)
        .put({ files, savedAt: Date.now() } satisfies StoredWorkspace, KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function load(): Promise<StoredWorkspace | null> {
  const db = await open();
  if (!db) return null;

  try {
    return await new Promise<StoredWorkspace | null>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);

      request.onsuccess = () => {
        const value: unknown = request.result;
        // Records outlive versions of the app; an old or corrupt one starts empty.
        const usable =
          typeof value === 'object' &&
          value !== null &&
          typeof (value as StoredWorkspace).files === 'object' &&
          (value as StoredWorkspace).files !== null;
        resolve(usable ? (value as StoredWorkspace) : null);
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function clear(): Promise<void> {
  const db = await open();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
