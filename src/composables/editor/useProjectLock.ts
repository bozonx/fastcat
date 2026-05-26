import { ref } from 'vue';
import { genUuid } from '~/utils/ids';
import { createDevLogger } from '~/utils/dev-logger';

const LOCK_CHANNEL_NAME = 'fastcat_project_locks';
const log = createDevLogger('ProjectLock');

/**
 * Create a unique ID for this instance (tab load)
 */
function createInstanceId(): string {
  if (typeof window === 'undefined') return 'server';
  return genUuid();
}

export function useProjectLock() {
  const tabId = ref(createInstanceId());
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
        log.log(`Received steal request for project: ${projectId} from tab: ${requesterTabId}`);
        await releaseLock();
        isLockLost.value = true;
      }
    };
  }

  function _cleanupChannel() {
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

    log.log(`Attempting to acquire lock: ${projectId} (Tab: ${tabId.value})`);

    if (typeof navigator === 'undefined' || !navigator.locks) {
      log.warn('[ProjectLock] Web Locks API not supported');
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
            log.warn(`[ProjectLock] Lock ${lockName} is unavailable`);
            resolveAcquire(false);
            return;
          }

          lockedProjectId.value = projectId;
          resolveAcquire(true);
          log.log(`Lock acquired for project: ${projectId}`);

          return new Promise<void>((resolveRelease) => {
            lockReleaseFn = resolveRelease;
          });
        })
        .catch((error) => {
          log.error('[ProjectLock] Lock acquisition error:', error);
          resolveAcquire(false);
        });
    });
  }

  /**
   * Request other tabs to release the lock for this project
   */
  async function stealLock(projectId: string) {
    if (broadcastChannel) {
      log.log(`Sending lock:steal to others for project: ${projectId}`);
      broadcastChannel.postMessage({
        type: 'lock:steal',
        projectId,
        requesterTabId: tabId.value,
      });

      // Give more time for other tab to release and browser to register it
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = await acquireLock(projectId);
    log.log(`Steal attempt result for ${projectId}: ${result ? 'SUCCESS' : 'FAILED'}`);
    return result;
  }

  async function releaseLock() {
    if (!lockedProjectId.value) return;

    const projectId = lockedProjectId.value;
    log.log(`Releasing lock for project: ${projectId}`);

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
