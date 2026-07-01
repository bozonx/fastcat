/** @vitest-environment node */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  isStorageManagerSupported,
  requestPersistentStorage,
  useStoragePersistence,
} from '~/composables/useStoragePersistence';

describe('useStoragePersistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(storage: unknown) {
    vi.stubGlobal('navigator', { storage });
  }

  describe('isStorageManagerSupported', () => {
    it('is false when navigator.storage is absent', () => {
      vi.stubGlobal('navigator', {});
      expect(isStorageManagerSupported()).toBe(false);
    });

    it('is true when navigator.storage exists', () => {
      stubStorage({});
      expect(isStorageManagerSupported()).toBe(true);
    });
  });

  describe('requestPersistentStorage', () => {
    it('returns null when persist() is unavailable', async () => {
      stubStorage({});
      expect(await requestPersistentStorage()).toBeNull();
    });

    it('returns true without re-prompting when already persisted', async () => {
      const persist = vi.fn();
      stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
      expect(await requestPersistentStorage()).toBe(true);
      expect(persist).not.toHaveBeenCalled();
    });

    it('calls persist() when not yet persisted', async () => {
      const persist = vi.fn().mockResolvedValue(true);
      stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
      expect(await requestPersistentStorage()).toBe(true);
      expect(persist).toHaveBeenCalledOnce();
    });

    it('returns null and swallows errors', async () => {
      stubStorage({
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockRejectedValue(new Error('denied')),
      });
      expect(await requestPersistentStorage()).toBeNull();
    });
  });

  describe('composable', () => {
    it('refresh() populates estimate + persisted state', async () => {
      stubStorage({
        persisted: vi.fn().mockResolvedValue(true),
        estimate: vi.fn().mockResolvedValue({ usage: 250, quota: 1000 }),
      });

      const s = useStoragePersistence();
      await s.refresh();

      expect(s.isPersisted.value).toBe(true);
      expect(s.usageBytes.value).toBe(250);
      expect(s.quotaBytes.value).toBe(1000);
      expect(s.usageRatio.value).toBeCloseTo(0.25);
    });

    it('usageRatio is null without a quota', async () => {
      stubStorage({ estimate: vi.fn().mockResolvedValue({ usage: 100, quota: 0 }) });
      const s = useStoragePersistence();
      await s.refresh();
      expect(s.usageRatio.value).toBeNull();
    });

    it('requestPersist() updates persisted state', async () => {
      // Mirror real browser behaviour: persisted() reflects the granted state
      // once persist() has succeeded.
      let granted = false;
      stubStorage({
        persisted: vi.fn().mockImplementation(async () => granted),
        persist: vi.fn().mockImplementation(async () => {
          granted = true;
          return true;
        }),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
      });

      const s = useStoragePersistence();
      await s.requestPersist();
      expect(s.isPersisted.value).toBe(true);
    });
  });
});
