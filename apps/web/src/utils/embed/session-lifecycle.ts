import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('embed-session-lifecycle');

/** Every embedded session's storage lives under this one OPFS directory. */
export const EMBED_ROOT_DIR_NAME = 'fastcat-embed';

const REGISTRY_DB_NAME = 'fastcat-embed';
const REGISTRY_DB_VERSION = 1;
const REGISTRY_STORE_NAME = 'sessions';

const HEARTBEAT_INTERVAL_MS = 15_000;
/**
 * Fallback liveness window for browsers without Web Locks. Generous on purpose:
 * with no lock to consult, a stale heartbeat is the only evidence of death, and
 * deleting a live session's media would be far worse than keeping dead bytes
 * around for a few extra minutes.
 */
const HEARTBEAT_GRACE_MS = 5 * 60_000;

function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}

export interface EmbedSessionRecord {
  id: string;
  createdAt: number;
  lastHeartbeatAt: number;
}

export function embedSessionDirPath(sessionId: string): string {
  return `${EMBED_ROOT_DIR_NAME}/${sessionId}`;
}

function sessionLockName(sessionId: string): string {
  return `fastcat-embed-session:${sessionId}`;
}

function openRegistry(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(REGISTRY_DB_NAME, REGISTRY_DB_VERSION);
    } catch (e) {
      // Third-party storage can be blocked outright; the caller degrades to
      // "no registry", which costs cleanup fidelity but never correctness.
      log.warn('Session registry unavailable', e);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(REGISTRY_STORE_NAME)) {
        db.createObjectStore(REGISTRY_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      log.warn('Failed to open the session registry', request.error);
      resolve(null);
    };
  });
}

function runRegistry<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openRegistry().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const request = action(
            db.transaction(REGISTRY_STORE_NAME, mode).objectStore(REGISTRY_STORE_NAME),
          );
          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => {
            log.warn('Session registry operation failed', request.error);
            resolve(null);
            db.close();
          };
        } catch (e) {
          log.warn('Session registry operation threw', e);
          resolve(null);
          db.close();
        }
      }),
  );
}

export async function registerSession(sessionId: string): Promise<void> {
  const now = Date.now();
  await runRegistry('readwrite', (store) =>
    store.put({ id: sessionId, createdAt: now, lastHeartbeatAt: now } satisfies EmbedSessionRecord),
  );
}

export async function forgetSession(sessionId: string): Promise<void> {
  await runRegistry('readwrite', (store) => store.delete(sessionId));
}

async function listSessions(): Promise<EmbedSessionRecord[]> {
  const records = await runRegistry<EmbedSessionRecord[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<EmbedSessionRecord[]>,
  );
  return records ?? [];
}

/**
 * Holds an exclusive Web Lock for as long as the session lives. A lock that can
 * be taken instantly means no tab is running that session — the one signal that
 * survives crashes, closed tabs and killed processes alike.
 *
 * Returns a release function, or null when the browser has no Web Locks (the
 * heartbeat then carries cleanup on its own).
 */
export async function acquireSessionLock(sessionId: string): Promise<(() => void) | null> {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;

  return new Promise<(() => void) | null>((resolve) => {
    void navigator.locks
      .request(sessionLockName(sessionId), { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return Promise.resolve();
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch((e: unknown) => {
        log.warn('Failed to acquire the session lock', e);
        resolve(null);
      });
  });
}

async function isSessionLockFree(sessionId: string): Promise<boolean> {
  if (!hasWebLocks()) return false;

  try {
    const state = await navigator.locks.query();
    const name = sessionLockName(sessionId);
    return !state.held?.some((lock) => lock.name === name);
  } catch (e) {
    log.warn('Failed to query session locks', e);
    return false;
  }
}

export function startSessionHeartbeat(sessionId: string): () => void {
  const timer = setInterval(() => {
    void runRegistry('readwrite', (store) => {
      // Re-read so a concurrent GC pass that already deleted the record does not
      // get it resurrected by a stale write.
      return store.get(sessionId) as IDBRequest<EmbedSessionRecord | undefined>;
    }).then((existing) => {
      if (!existing) return;
      void runRegistry('readwrite', (store) =>
        store.put({ ...existing, lastHeartbeatAt: Date.now() } satisfies EmbedSessionRecord),
      );
    });
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

async function removeSessionDirectory(sessionId: string): Promise<void> {
  const root = await navigator.storage?.getDirectory();
  if (!root) return;

  const embedRoot = await root.getDirectoryHandle(EMBED_ROOT_DIR_NAME).catch(() => null);
  if (!embedRoot) return;

  await embedRoot.removeEntry(sessionId, { recursive: true }).catch((e: unknown) => {
    log.warn(`Failed to remove session directory ${sessionId}`, e);
  });
}

export async function removeSession(sessionId: string): Promise<void> {
  await removeSessionDirectory(sessionId);
  await forgetSession(sessionId);
}

/**
 * Reclaims storage left behind by sessions that never got to clean up after
 * themselves.
 *
 * Running this at startup rather than at teardown is the whole design: an
 * unload handler cannot reliably finish asynchronous OPFS deletes, and a killed
 * tab never runs one at all. Sweeping on the way *in* catches every one of those
 * cases with no reliance on the previous session's cooperation.
 */
export async function collectAbandonedSessions(keepSessionId?: string): Promise<string[]> {
  const removed: string[] = [];
  const records = await listSessions();
  const known = new Set(records.map((record) => record.id));
  const now = Date.now();
  const locksAvailable = hasWebLocks();

  for (const record of records) {
    if (record.id === keepSessionId) continue;
    // A session takes its lock *before* it is registered, so any registered
    // session whose lock is free has no live context behind it — the browser
    // releases locks when the tab goes, however it went. No waiting period is
    // needed. Without Web Locks there is nothing to consult but the heartbeat.
    const isDead = locksAvailable
      ? await isSessionLockFree(record.id)
      : now - record.lastHeartbeatAt > HEARTBEAT_GRACE_MS;
    if (!isDead) continue;

    await removeSession(record.id);
    removed.push(record.id);
  }

  // Directories with no registry entry are orphans from a browser that denied
  // IndexedDB, or from a crash between mkdir and the first registry write.
  const root = await navigator.storage?.getDirectory();
  const embedRoot = await root?.getDirectoryHandle(EMBED_ROOT_DIR_NAME).catch(() => null);
  if (!embedRoot) return removed;

  for await (const entry of embedRoot as unknown as AsyncIterable<FileSystemHandle>) {
    if (entry.kind !== 'directory') continue;
    if (entry.name === keepSessionId || known.has(entry.name)) continue;
    if (locksAvailable && !(await isSessionLockFree(entry.name))) continue;

    await removeSessionDirectory(entry.name);
    removed.push(entry.name);
  }

  return removed;
}
