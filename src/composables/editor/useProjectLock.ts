import { ref } from 'vue';

const TAB_ID_SESSION_KEY = 'gran_project_lock_tab_id';

/**
 * Get or create a unique ID for this session (tab)
 */
function getOrCreateTabId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = sessionStorage.getItem(TAB_ID_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_SESSION_KEY, id);
  }
  return id;
}

export function useProjectLock() {
  const tabId = ref(getOrCreateTabId());
  const lockedProjectId = ref<string | null>(null);

  let lockReleaseFn: (() => void) | null = null;

  function getLockName(projectId: string): string {
    return `gran-project-lock-${projectId}`;
  }

  /**
   * Acquire a lock for the project using Web Locks API.
   * Returns true if lock was acquired, false if it's already held by another tab.
   */
  async function acquireLock(projectId: string): Promise<boolean> {
    const lockName = getLockName(projectId);
    console.log(`[ProjectLock] Attempting to acquire lock for project: ${projectId}`, {
      tabId: tabId.value,
    });

    if (typeof navigator === 'undefined' || !navigator.locks) {
      console.warn('[ProjectLock] Web Locks API not supported in this environment');
      // Fallback: allow entry but without actual locking
      lockedProjectId.value = projectId;
      return true;
    }

    // If we already have a lock, release it first
    if (lockedProjectId.value) {
      await releaseLock();
    }

    return new Promise<boolean>((resolveAcquire) => {
      navigator.locks
        .request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) {
            console.warn(`[ProjectLock] Project is already locked by another active tab`);
            resolveAcquire(false);
            return;
          }

          lockedProjectId.value = projectId;
          resolveAcquire(true);
          console.log(`[ProjectLock] Lock successfully acquired for project: ${projectId}`);

          // Hold the lock until releaseLock is called
          return new Promise<void>((resolveRelease) => {
            lockReleaseFn = resolveRelease;
          });
        })
        .catch((error) => {
          console.error('[ProjectLock] Error during lock acquisition:', error);
          resolveAcquire(false);
        });
    });
  }

  async function releaseLock() {
    if (!lockedProjectId.value) return;

    const projectId = lockedProjectId.value;
    console.log(`[ProjectLock] Releasing lock for project: ${projectId}`);

    if (lockReleaseFn) {
      lockReleaseFn();
      lockReleaseFn = null;
    }

    lockedProjectId.value = null;
  }

  function handleBeforeUnload() {
    if (lockedProjectId.value) {
      releaseLock().catch(() => {});
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleBeforeUnload);
  }

  return {
    acquireLock,
    releaseLock,
    isLocked: () => lockedProjectId.value !== null,
  };
}
