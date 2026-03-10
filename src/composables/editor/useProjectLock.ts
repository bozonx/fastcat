import { ref } from 'vue';
import { useNuxtApp } from 'nuxt/app';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getProjectTmpSegments } from '~/utils/vardata-paths';

interface ProjectLockData {
  tabId: string;
  timestamp: number;
}

const LOCK_FILE_NAME = '.lock';
const HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
const LOCK_TIMEOUT_MS = 20000; // 20 seconds
const TAB_ID_SESSION_KEY = 'gran_project_lock_tab_id';

/**
 * Utility to sleep for a given duration
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const nuxtApp = useNuxtApp();

  const tabId = ref(getOrCreateTabId());
  const lockedProjectId = ref<string | null>(null);
  const heartbeatInterval = ref<number | null>(null);

  function getVfs(): IFileSystemAdapter {
    const vfs = nuxtApp.$vfs as IFileSystemAdapter;
    if (!vfs) {
      throw new Error('VFS adapter not initialized');
    }
    return vfs;
  }

  function getLockFilePath(projectId: string): string {
    const tmpDir = getProjectTmpSegments(projectId).join('/');
    return `/${tmpDir}/${LOCK_FILE_NAME}`;
  }

  /**
   * Acquire a lock for the project.
   * Returns true if lock was acquired, false if it's already held by another tab.
   */
  async function acquireLock(projectId: string): Promise<boolean> {
    const lockFilePath = getLockFilePath(projectId);
    console.log(`[ProjectLock] Attempting to acquire lock for project: ${projectId}`, {
      tabId: tabId.value,
    });

    try {
      // Ensure tmp directory exists
      const tmpDirPath = `/${getProjectTmpSegments(projectId).join('/')}`;
      const dirExists = await getVfs().exists(tmpDirPath);
      if (!dirExists) {
        await getVfs().createDirectory(tmpDirPath);
      }

      // Check existing lock
      const lockExists = await getVfs().exists(lockFilePath);
      if (lockExists) {
        const file = await getVfs().readFile(lockFilePath);
        const text = await file.text();
        try {
          const lockData = JSON.parse(text) as ProjectLockData;
          const now = Date.now();

          const isStale = now - lockData.timestamp >= LOCK_TIMEOUT_MS;
          const isMine = lockData.tabId === tabId.value;

          if (!isStale && !isMine) {
            console.warn(
              `[ProjectLock] Project is already locked by another active tab: ${lockData.tabId}`,
            );
            return false;
          }

          if (isMine) {
            console.log('[ProjectLock] We already own the lock (from previous load or refresh)');
          } else if (isStale) {
            console.log('[ProjectLock] Existing lock is stale, overwriting');
          }
        } catch (e) {
          console.warn('[ProjectLock] Failed to parse lock file, assuming invalid and overwriting', e);
        }
      }

      // Take lock
      await writeLockFile(lockFilePath);

      // To prevent race conditions, wait a bit and verify we still own it
      // (in case another tab wrote its ID at the exact same moment)
      await sleep(100 + Math.random() * 100);
      const verified = await verifyLock(lockFilePath);
      if (!verified) {
        console.error('[ProjectLock] Lock verification failed - lost race condition');
        return false;
      }

      lockedProjectId.value = projectId;
      startHeartbeat(lockFilePath);

      console.log(`[ProjectLock] Lock successfully acquired for project: ${projectId}`);
      return true;
    } catch (error) {
      console.error('[ProjectLock] Error during lock acquisition:', error);
      // Fail-safe: if lock mechanism itself fails, allow entry but log error
      return true;
    }
  }

  async function verifyLock(lockFilePath: string): Promise<boolean> {
    try {
      const lockExists = await getVfs().exists(lockFilePath);
      if (!lockExists) return false;

      const file = await getVfs().readFile(lockFilePath);
      const text = await file.text();
      const lockData = JSON.parse(text) as ProjectLockData;

      return lockData.tabId === tabId.value;
    } catch (e) {
      console.warn('[ProjectLock] Failed to verify lock:', e);
      return false;
    }
  }

  async function writeLockFile(lockFilePath: string) {
    const lockData: ProjectLockData = {
      tabId: tabId.value,
      timestamp: Date.now(),
    };

    const blob = new Blob([JSON.stringify(lockData)], { type: 'application/json' });
    const file = new File([blob], LOCK_FILE_NAME, { type: 'application/json' });

    await getVfs().writeFile(lockFilePath, file);
  }

  function startHeartbeat(lockFilePath: string) {
    stopHeartbeat();

    heartbeatInterval.value = window.setInterval(async () => {
      try {
        await writeLockFile(lockFilePath);
      } catch (error) {
        console.error('[ProjectLock] Failed to update heartbeat:', error);
        // If we fail multiple heartbeats, we might want to trigger read-only mode here,
        // but for now we just log it.
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatInterval.value !== null) {
      window.clearInterval(heartbeatInterval.value);
      heartbeatInterval.value = null;
    }
  }

  async function releaseLock() {
    if (!lockedProjectId.value) return;

    const projectId = lockedProjectId.value;
    lockedProjectId.value = null;
    stopHeartbeat();

    console.log(`[ProjectLock] Releasing lock for project: ${projectId}`);

    const lockFilePath = getLockFilePath(projectId);
    try {
      const lockExists = await getVfs().exists(lockFilePath);
      if (lockExists) {
        const file = await getVfs().readFile(lockFilePath);
        const text = await file.text();
        const lockData = JSON.parse(text) as ProjectLockData;

        // Only delete if we still own the lock
        if (lockData.tabId === tabId.value) {
          await getVfs().deleteEntry(lockFilePath);
          console.log('[ProjectLock] Lock file deleted');
        }
      }
    } catch (error) {
      console.error('[ProjectLock] Error releasing project lock:', error);
    }
  }

  function handleBeforeUnload() {
    if (lockedProjectId.value) {
      // This is a last-ditch effort, may not complete if async.
      // But sessionStorage will help the next tab if this one didn't release it.
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

