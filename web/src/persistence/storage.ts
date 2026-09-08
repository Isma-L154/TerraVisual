/**
 * Keeping a workspace between sessions.
 *
 * IndexedDB rather than localStorage: a workspace can be megabytes, which
 * localStorage refuses, and it stores strings synchronously on the main thread
 * — the one place this application has promised not to block.
 *
 * Everything here degrades rather than throws. Storage can be unavailable for
 * reasons that have nothing to do with us: private browsing, a full disk, a
 * browser configured to block site data. Losing persistence is a small
 * disappointment; losing the editor because persistence failed is not.
 */

const DATABASE = 'terravisual';
const STORE = 'workspace';
const KEY = 'current';
const VERSION = 1;

export type StoredWorkspace = {
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
    // A browser prompting for permission can leave this pending forever, and
    // an editor that never appears is worse than one that forgets.
    request.onblocked = () => resolve(null);
  });
}

/** Saves the workspace. Returns whether it was actually stored. */
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

/** Loads the stored workspace, or null when there is nothing usable. */
export async function load(): Promise<StoredWorkspace | null> {
  const db = await open();
  if (!db) return null;

  try {
    return await new Promise<StoredWorkspace | null>((resolve) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(KEY);

      request.onsuccess = () => {
        const value: unknown = request.result;
        // Stored data is our own, but it survives across versions of this
        // application. Checking the shape means an old or corrupted record
        // starts an empty session instead of breaking the new one.
        if (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as StoredWorkspace).files === 'object' &&
          (value as StoredWorkspace).files !== null
        ) {
          resolve(value as StoredWorkspace);
          return;
        }
        resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/** Forgets the stored workspace. */
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
