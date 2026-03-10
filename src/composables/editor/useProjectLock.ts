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

export function useProjectLock() {
  const nuxtApp = useNuxtApp();
  const vfs = nuxtApp.$vfs as IFileSystemAdapter;

  const tabId = ref(crypto.randomUUID());
  const lockedProjectId = ref<string | null>(null);
  const heartbeatInterval = ref<number | null>(null);

  function getLockFilePath(projectId: string): string {
    const tmpDir = getProjectTmpSegments(projectId).join('/');
    return `/${tmpDir}/${LOCK_FILE_NAME}`;
  }

  async function acquireLock(projectId: string): Promise<boolean> {
    const lockFilePath = getLockFilePath(projectId);

    try {
      // Ensure tmp directory exists
      const tmpDirPath = `/${getProjectTmpSegments(projectId).join('/')}`;
      const dirExists = await vfs.exists(tmpDirPath);
      if (!dirExists) {
        await vfs.createDirectory(tmpDirPath);
      }

      // Check existing lock
      const lockExists = await vfs.exists(lockFilePath);
      if (lockExists) {
        const file = await vfs.readFile(lockFilePath);
        const text = await file.text();
        try {
          const lockData = JSON.parse(text) as ProjectLockData;
          const now = Date.now();

          if (now - lockData.timestamp < LOCK_TIMEOUT_MS && lockData.tabId !== tabId.value) {
            // Project is locked by another active tab
            return false;
          }
        } catch (e) {
          console.warn('Failed to parse lock file, assuming invalid and overwriting', e);
        }
      }

      // Take lock
      await writeLockFile(lockFilePath);

      lockedProjectId.value = projectId;
      startHeartbeat(lockFilePath);

      return true;
    } catch (error) {
      console.error('Error acquiring project lock:', error);
      // In case of error, we default to allowing access but log it
      return true;
    }
  }

  async function writeLockFile(lockFilePath: string) {
    const lockData: ProjectLockData = {
      tabId: tabId.value,
      timestamp: Date.now(),
    };

    // Convert string to File object for VFS
    const blob = new Blob([JSON.stringify(lockData)], { type: 'application/json' });
    const file = new File([blob], LOCK_FILE_NAME, { type: 'application/json' });

    await vfs.writeFile(lockFilePath, file);
  }

  function startHeartbeat(lockFilePath: string) {
    stopHeartbeat();

    heartbeatInterval.value = window.setInterval(async () => {
      try {
        await writeLockFile(lockFilePath);
      } catch (error) {
        console.error('Failed to update project lock heartbeat:', error);
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

    stopHeartbeat();

    const lockFilePath = getLockFilePath(lockedProjectId.value);
    try {
      const lockExists = await vfs.exists(lockFilePath);
      if (lockExists) {
        const file = await vfs.readFile(lockFilePath);
        const text = await file.text();
        const lockData = JSON.parse(text) as ProjectLockData;

        // Only delete if we still own the lock
        if (lockData.tabId === tabId.value) {
          await vfs.deleteEntry(lockFilePath);
        }
      }
    } catch (error) {
      console.error('Error releasing project lock:', error);
    } finally {
      lockedProjectId.value = null;
    }
  }

  // Handle window close/refresh
  function handleBeforeUnload() {
    if (lockedProjectId.value) {
      // releaseLock is async, but beforeunload doesn't wait for promises.
      // However, OPFS operations might complete fast enough, and if not, the timeout will handle it.
      releaseLock().catch(console.error);
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
