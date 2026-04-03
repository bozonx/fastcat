import { ref } from 'vue';

const TAB_ID_SESSION_KEY = 'fastcat_project_lock_tab_id';
const LOCK_CHANNEL_NAME = 'fastcat_project_locks';

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
  const isLockLost = ref(false);

  let lockReleaseFn: (() => void) | null = null;
  let broadcastChannel: BroadcastChannel | null = null;

  function getLockName(projectId: string): string {
    return `fastcat-project-lock-${projectId}`;
  }

  function setupChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    broadcastChannel = new BroadcastChannel(LOCK_CHANNEL_NAME);
    broadcastChannel.onmessage = async (event) => {
      const { type, projectId, requesterTabId } = event.data;

      if (requesterTabId === tabId.value) return;

      if (type === 'lock:steal' && lockedProjectId.value === projectId) {
        console.log(`[ProjectLock] Another tab (${requesterTabId}) is stealing the lock for project: ${projectId}`);
        await releaseLock();
        isLockLost.value = true;
      }
    };
  }

  function cleanupChannel() {
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
  }

  /**
   * Acquire a lock for the project using Web Locks API.
   * Returns true if lock was acquired, false if it's already held by another tab.
   */
  async function acquireLock(projectId: string): Promise<boolean> {
    const lockName = getLockName(projectId);
    isLockLost.value = false;
    
    console.log(`[ProjectLock] Attempting to acquire lock for project: ${projectId}`, {
      tabId: tabId.value,
    });

    if (typeof navigator === 'undefined' || !navigator.locks) {
      console.warn('[ProjectLock] Web Locks API not supported in this environment');
      lockedProjectId.value = projectId;
      return true;
    }

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

  /**
   * Request other tabs to release the lock for this project
   */
  async function stealLock(projectId: string) {
    if (broadcastChannel) {
      console.log(`[ProjectLock] Sending steal request for project: ${projectId}`);
      broadcastChannel.postMessage({
        type: 'lock:steal',
        projectId,
        requesterTabId: tabId.value,
      });
      
      // Give bit of time for other tab to release
      await new Promise(r => setTimeout(r, 200));
    }
    return acquireLock(projectId);
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
    setupChannel();
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // We can't use onUnmounted reliably in a global store that's never disposed,
    // but we can ensure we don't leak by closing the channel if we ever recreate.
  }

  return {
    acquireLock,
    releaseLock,
    stealLock,
    isLocked: () => lockedProjectId.value !== null,
    isLockLost,
  };
}
