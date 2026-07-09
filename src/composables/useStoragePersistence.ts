import { ref, computed, readonly } from 'vue';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('storage-persistence');

/**
 * Wraps the browser Storage API (`navigator.storage`) so the web build can:
 *   - report how much OPFS quota is used vs available (`estimate()`), and
 *   - opt into persistent storage (`persist()`), which asks the browser not to
 *     evict the workspace under storage pressure.
 *
 * All calls are best-effort and safe to run in unsupported environments (Tauri,
 * SSR, private-mode Safari): they resolve to null / no-op instead of throwing.
 */
export function isStorageManagerSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage;
}

/**
 * Whether the browser actually exposes `navigator.storage.persist()`. This is a
 * narrower check than {@link isStorageManagerSupported}: some environments have
 * a StorageManager (quota + estimate) but no persist capability (e.g. private
 * mode). Used to decide whether to offer the persistence toggle at all.
 */
export function isPersistSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';
}

/**
 * Best-effort request for persistent storage. Returns the resulting persisted
 * state, or null when the API is unavailable. Fire-and-forget safe.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!isStorageManagerSupported() || typeof navigator.storage.persist !== 'function') {
    return null;
  }
  try {
    // Already granted — avoid re-prompting.
    if (
      typeof navigator.storage.persisted === 'function' &&
      (await navigator.storage.persisted())
    ) {
      return true;
    }
    return await navigator.storage.persist();
  } catch (e) {
    log.warn('navigator.storage.persist() failed', e);
    return null;
  }
}

export function useStoragePersistence() {
  const isSupported = isStorageManagerSupported();
  const persistAvailable = isPersistSupported();

  // null = unknown / not yet queried.
  const isPersisted = ref<boolean | null>(null);
  const usageBytes = ref<number | null>(null);
  const quotaBytes = ref<number | null>(null);
  const isRefreshing = ref(false);
  const isRequesting = ref(false);
  // True when the browser explicitly refused the persist() request. Stays
  // false on success, null (unsupported) or not-yet-requested.
  const persistDeclined = ref(false);

  const usageRatio = computed(() => {
    if (usageBytes.value == null || !quotaBytes.value) return null;
    return Math.min(1, usageBytes.value / quotaBytes.value);
  });

  async function refresh(): Promise<void> {
    if (!isSupported) return;
    isRefreshing.value = true;
    try {
      if (typeof navigator.storage.persisted === 'function') {
        isPersisted.value = await navigator.storage.persisted();
      }
      if (typeof navigator.storage.estimate === 'function') {
        const { usage, quota } = await navigator.storage.estimate();
        usageBytes.value = usage ?? null;
        quotaBytes.value = quota ?? null;
      }
    } catch (e) {
      log.warn('Failed to read storage estimate', e);
    } finally {
      isRefreshing.value = false;
    }
  }

  async function requestPersist(): Promise<void> {
    if (!isSupported) return;
    isRequesting.value = true;
    persistDeclined.value = false;
    try {
      const result = await requestPersistentStorage();
      // result === false means the browser actively declined the request
      // (e.g. private mode, insufficient engagement). null means unsupported.
      if (result === false) persistDeclined.value = true;
      if (result != null) isPersisted.value = result;
      await refresh();
    } finally {
      isRequesting.value = false;
    }
  }

  return {
    isSupported,
    isPersistSupported: persistAvailable,
    isPersisted: readonly(isPersisted),
    persistDeclined: readonly(persistDeclined),
    usageBytes: readonly(usageBytes),
    quotaBytes: readonly(quotaBytes),
    usageRatio,
    isRefreshing: readonly(isRefreshing),
    isRequesting: readonly(isRequesting),
    refresh,
    requestPersist,
  };
}
