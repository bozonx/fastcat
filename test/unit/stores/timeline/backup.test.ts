/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

import { createTimelineBackupModule } from '~/stores/timeline/backup';
import type { TimelineBackupDeps } from '~/stores/timeline/backup';

// The module wraps every file access in withFileIoSlot / runResilientFileWrite;
// make them transparent so tests exercise the backup logic, not the io budget.
vi.mock('~/utils/io/io-governor', () => ({
  withFileIoSlot: <T>(task: () => Promise<T>) => task(),
  runResilientFileWrite: <T>(task: () => Promise<T>) => task(),
}));

function fakeFileHandle(file: { lastModified: number; size: number }) {
  return { getFile: vi.fn().mockResolvedValue(file) } as unknown as FileSystemFileHandle;
}

function createMockDeps(overrides: Partial<TimelineBackupDeps> = {}): TimelineBackupDeps {
  return {
    timelineDoc: ref(null),
    currentTimelinePath: ref('project/clip.otio'),
    duration: ref(0),
    currentTime: ref(0),
    previewMode: ref(false),
    previewBackupInfo: ref(null),
    projectStore: {
      getDirectoryHandleByPath: vi.fn().mockResolvedValue(null),
      getFileHandleByPath: vi.fn().mockResolvedValue(null),
      createFallbackTimelineDoc: vi.fn(),
    },
    workspaceStore: { userSettings: { backup: { enabled: true, count: 5 } } },
    toast: { add: vi.fn() },
    t: ((key: string) => key) as TimelineBackupDeps['t'],
    loadTimeline: vi.fn().mockResolvedValue(undefined),
    deleteTimelineAutosaveFile: vi.fn().mockResolvedValue(undefined),
    ensureTimelineFileHandle: vi.fn().mockResolvedValue(null),
    markTimelineAsDirty: vi.fn(),
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createTimelineBackupModule', () => {
  describe('loadBackupVersions', () => {
    it('clears the list when there is no open timeline path', async () => {
      const deps = createMockDeps({ currentTimelinePath: ref(null) });
      const backup = createTimelineBackupModule(deps);
      backup.backupVersions.value = [
        { type: 'main', name: 'stale', path: 'x', date: null, size: null, label: 'x' },
      ];

      await backup.loadBackupVersions();

      expect(backup.backupVersions.value).toEqual([]);
    });

    it('lists the main file and autosave when both handles resolve', async () => {
      const ensureTimelineFileHandle = vi
        .fn()
        .mockResolvedValue(fakeFileHandle({ lastModified: 1000, size: 42 }));
      const deps = createMockDeps({ ensureTimelineFileHandle });
      const backup = createTimelineBackupModule(deps);

      await backup.loadBackupVersions();

      expect(backup.backupVersions.value.map((v) => v.type)).toEqual(['main', 'autosave']);
      const main = backup.backupVersions.value[0];
      expect(main.path).toBe('project/clip.otio');
      expect(main.size).toBe(42);
      expect(backup.backupVersions.value[1].path).toBe('.fastcat/autosave/project/clip.otio');
    });
  });

  describe('handleBackup', () => {
    it('does nothing when backups are disabled', async () => {
      const deps = createMockDeps({
        workspaceStore: { userSettings: { backup: { enabled: false, count: 5 } } },
      });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(deps.projectStore.getDirectoryHandleByPath).not.toHaveBeenCalled();
    });

    it('does nothing when there is no open timeline path', async () => {
      const deps = createMockDeps({ currentTimelinePath: ref(null) });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(deps.projectStore.getDirectoryHandleByPath).not.toHaveBeenCalled();
    });
  });

  describe('exitPreviewAndReload', () => {
    it('clears preview state and reloads the timeline', async () => {
      const deps = createMockDeps({ previewMode: ref(true) });
      const backup = createTimelineBackupModule(deps);

      await backup.exitPreviewAndReload();

      expect(deps.previewMode.value).toBe(false);
      expect(deps.previewBackupInfo.value).toBeNull();
      expect(deps.loadTimeline).toHaveBeenCalledOnce();
    });
  });
});
