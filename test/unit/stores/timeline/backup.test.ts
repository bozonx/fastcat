/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

import { createTimelineBackupModule } from '~/stores/timeline/backup';
import type { TimelineBackupDeps } from '~/stores/timeline/backup';

vi.mock('~/utils/io/io-governor', () => ({
  withFileIoSlot: <T>(task: () => Promise<T>) => task(),
}));

type FileMeta = { text: string; lastModified: number };

function makeProjectStoreMock(files: Record<string, FileMeta> = {}) {
  return {
    readTextByPath: vi.fn(async (p: string) => files[p]?.text ?? null),
    writeTextByPath: vi.fn(async (p: string, text: string) => {
      files[p] = { text, lastModified: Date.now() };
    }),
    deleteByPath: vi.fn(async (p: string) => {
      delete files[p];
    }),
    listEntryNames: vi.fn(async (_p: string) => Object.keys(files).map((k) => k.split('/').pop()!)),
    getFileMetadata: vi.fn(async (p: string) => {
      const f = files[p];
      return f ? { lastModified: f.lastModified, size: f.text.length } : null;
    }),
    createFallbackTimelineDoc: vi.fn(() => ({
      id: 'fallback',
      name: 'Fallback',
      tracks: [],
      timebase: { fps: 30 },
      metadata: { fastcat: { version: '1', format: { fps: 30 } } },
    })),
  };
}

function createMockDeps(overrides: Partial<TimelineBackupDeps> = {}): TimelineBackupDeps {
  return {
    timelineDoc: ref(null),
    currentTimelinePath: ref('project/clip.otio'),
    duration: ref(0),
    currentTime: ref(0),
    previewMode: ref(false),
    previewBackupInfo: ref(null),
    isMobile: ref(false),
    isDirty: ref(false),
    projectStore: makeProjectStoreMock(),
    workspaceStore: { userSettings: { backup: { count: 5 } } },
    toast: { add: vi.fn() },
    t: ((key: string) => key) as TimelineBackupDeps['t'],
    loadTimeline: vi.fn().mockResolvedValue(undefined),
    deleteTimelineAutosaveFile: vi.fn().mockResolvedValue(undefined),
    readTimelineFile: vi.fn().mockResolvedValue(null),
    markTimelineAsDirty: vi.fn(),
    requestTimelineSave: vi.fn().mockResolvedValue(undefined),
    saveTimeline: vi.fn().mockResolvedValue(undefined),
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

    it('lists the main file and does not list autosave when both exist', async () => {
      const files: Record<string, FileMeta> = {
        'project/clip.otio': { text: 'main', lastModified: 1000 },
        '.fastcat/autosave/project/clip.otio': { text: 'autosave', lastModified: 2000 },
      };
      const deps = createMockDeps({ projectStore: makeProjectStoreMock(files) });
      const backup = createTimelineBackupModule(deps);

      await backup.loadBackupVersions();

      expect(backup.backupVersions.value.map((v) => v.type)).toEqual(['main']);
      const main = backup.backupVersions.value[0];
      expect(main.path).toBe('project/clip.otio');
      expect(main.size).toBe(4); // 'main'.length
    });

    it('does not flush autosave or list it when isMobile is true', async () => {
      const files: Record<string, FileMeta> = {
        'project/clip.otio': { text: 'main', lastModified: 1000 },
        '.fastcat/autosave/project/clip.otio': { text: 'autosave', lastModified: 2000 },
      };
      const deps = createMockDeps({
        projectStore: makeProjectStoreMock(files),
        isMobile: ref(true),
      });
      const backup = createTimelineBackupModule(deps);

      await backup.loadBackupVersions();

      expect(deps.requestTimelineSave).not.toHaveBeenCalled();
      expect(backup.backupVersions.value.map((v) => v.type)).toEqual(['main']);
    });

    it('does not flush autosave when isDirty is true', async () => {
      const files: Record<string, FileMeta> = {
        'project/clip.otio': { text: 'main', lastModified: 1000 },
      };
      const deps = createMockDeps({
        projectStore: makeProjectStoreMock(files),
        isDirty: ref(true),
      });
      const backup = createTimelineBackupModule(deps);

      await backup.loadBackupVersions();

      expect(deps.requestTimelineSave).not.toHaveBeenCalled();
    });
  });

  describe('handleBackup', () => {
    it('does nothing when backups are disabled', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({
        projectStore,
        workspaceStore: { userSettings: { backup: { count: 0 } } },
      });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(projectStore.writeTextByPath).not.toHaveBeenCalled();
    });

    it('does nothing when backup.enabled is false', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({
        projectStore,
        workspaceStore: { userSettings: { backup: { enabled: false, count: 5 } } },
      });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(projectStore.writeTextByPath).not.toHaveBeenCalled();
    });

    it('does nothing when there is no open timeline path', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({ currentTimelinePath: ref(null), projectStore });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(projectStore.writeTextByPath).not.toHaveBeenCalled();
    });

    it('writes a backup file when count > 0', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({ projectStore });
      const backup = createTimelineBackupModule(deps);

      await backup.handleBackup('<serialized>');

      expect(projectStore.writeTextByPath).toHaveBeenCalledWith(
        expect.stringContaining('.fastcat/backups/project/clip__bak'),
        '<serialized>',
      );
    });
  });

  describe('preserveAndDiscardAutosave', () => {
    it('rotates the autosave content into a backup, then deletes the sidecar', async () => {
      const projectStore = makeProjectStoreMock();
      const deleteTimelineAutosaveFile = vi.fn().mockResolvedValue(undefined);
      const readTimelineFile = vi
        .fn()
        .mockResolvedValue({ text: '<unsaved>', lastModified: 200, size: 9 });
      const deps = createMockDeps({ projectStore, readTimelineFile, deleteTimelineAutosaveFile });
      const backup = createTimelineBackupModule(deps);

      await backup.preserveAndDiscardAutosave('project/clip.otio');

      expect(readTimelineFile).toHaveBeenCalledWith('.fastcat/autosave/project/clip.otio');
      expect(projectStore.writeTextByPath).toHaveBeenCalledWith(
        expect.stringContaining('.fastcat/backups/project/clip__bak'),
        '<unsaved>',
      );
      expect(deleteTimelineAutosaveFile).toHaveBeenCalledWith('project/clip.otio');
    });

    it('preserves autosave content even when routine backups are disabled', async () => {
      const projectStore = makeProjectStoreMock();
      const deleteTimelineAutosaveFile = vi.fn().mockResolvedValue(undefined);
      const readTimelineFile = vi
        .fn()
        .mockResolvedValue({ text: '<unsaved>', lastModified: 200, size: 9 });
      const deps = createMockDeps({
        projectStore,
        readTimelineFile,
        deleteTimelineAutosaveFile,
        workspaceStore: { userSettings: { backup: { count: 0 } } },
      });
      const backup = createTimelineBackupModule(deps);

      await backup.preserveAndDiscardAutosave('project/clip.otio');

      expect(projectStore.writeTextByPath).toHaveBeenCalledWith(
        expect.stringContaining('.fastcat/backups/project/clip__bak'),
        '<unsaved>',
      );
      expect(deleteTimelineAutosaveFile).toHaveBeenCalledWith('project/clip.otio');
    });

    it('still deletes the sidecar even if preserving the backup fails', async () => {
      const projectStore = makeProjectStoreMock();
      const deleteTimelineAutosaveFile = vi.fn().mockResolvedValue(undefined);
      const readTimelineFile = vi.fn().mockRejectedValue(new Error('read failed'));
      const deps = createMockDeps({ projectStore, readTimelineFile, deleteTimelineAutosaveFile });
      const backup = createTimelineBackupModule(deps);

      await backup.preserveAndDiscardAutosave('project/clip.otio');

      expect(projectStore.writeTextByPath).not.toHaveBeenCalled();
      expect(deleteTimelineAutosaveFile).toHaveBeenCalledWith('project/clip.otio');
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

  describe('readonly guards', () => {
    it('restoreVersion shows warning and does nothing when readonly', async () => {
      const deps = createMockDeps({
        isReadOnly: ref(true),
        previewMode: ref(false),
        timelineDoc: ref({ id: 'doc', tracks: [] } as any),
      });
      const backup = createTimelineBackupModule(deps);

      await backup.restoreVersion({
        type: 'main',
        name: 'clip.otio',
        path: 'project/clip.otio',
        date: new Date(),
        size: 10,
        label: 'Main',
      });

      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.saveBlockedReadOnlyTitle',
          color: 'warning',
        }),
      );
      expect(deps.markTimelineAsDirty).not.toHaveBeenCalled();
      expect(deps.saveTimeline).not.toHaveBeenCalled();
    });

    it('restorePreviewVersion shows warning and does nothing when readonly', async () => {
      const deps = createMockDeps({
        isReadOnly: ref(true),
        previewMode: ref(true),
        timelineDoc: ref({ id: 'doc', tracks: [] } as any),
      });
      const backup = createTimelineBackupModule(deps);

      await backup.restorePreviewVersion();

      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.saveBlockedReadOnlyTitle',
          color: 'warning',
        }),
      );
      expect(deps.previewMode.value).toBe(true);
      expect(deps.markTimelineAsDirty).not.toHaveBeenCalled();
    });

    it('deleteBackupVersion shows warning and does nothing when readonly', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({
        isReadOnly: ref(true),
        previewMode: ref(false),
        projectStore,
      });
      const backup = createTimelineBackupModule(deps);

      await backup.deleteBackupVersion({
        type: 'backup',
        name: 'bak',
        path: 'project/clip__bak1.otio',
        date: new Date(),
        size: 10,
        label: 'Backup #1',
      });

      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.saveBlockedReadOnlyTitle',
          color: 'warning',
        }),
      );
      expect(projectStore.deleteByPath).not.toHaveBeenCalled();
    });
  });

  describe('restoreVersion', () => {
    it('calls saveTimeline after restoring a version', async () => {
      const files: Record<string, FileMeta> = {
        'project/clip.otio': { text: 'main', lastModified: 1000 },
      };
      const deps = createMockDeps({ projectStore: makeProjectStoreMock(files) });
      deps.readTimelineFile.mockResolvedValue({ text: 'restored', lastModified: 500, size: 8 });
      const backup = createTimelineBackupModule(deps);

      await backup.restoreVersion({
        type: 'main',
        name: 'clip.otio',
        path: 'project/clip.otio',
        date: new Date(),
        size: 10,
        label: 'Main',
      });

      expect(deps.saveTimeline).toHaveBeenCalled();
      expect(deps.requestTimelineSave).not.toHaveBeenCalled();
    });
  });

  describe('restorePreviewVersion', () => {
    it('calls saveTimeline after restoring preview', async () => {
      const deps = createMockDeps({
        timelineDoc: ref({ id: 'doc', tracks: [] } as any),
      });
      const backup = createTimelineBackupModule(deps);

      await backup.restorePreviewVersion();

      expect(deps.saveTimeline).toHaveBeenCalled();
      expect(deps.requestTimelineSave).not.toHaveBeenCalled();
    });
  });

  describe('deleteBackupVersion', () => {
    it('warns and does nothing when trying to delete main file', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({ projectStore });
      const backup = createTimelineBackupModule(deps);

      await backup.deleteBackupVersion({
        type: 'main',
        name: 'clip.otio',
        path: 'project/clip.otio',
        date: new Date(),
        size: 10,
        label: 'Main',
      });

      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.backups.cannotDeleteMain',
          color: 'warning',
        }),
      );
      expect(projectStore.deleteByPath).not.toHaveBeenCalled();
    });
  });

  describe('loadBackupVersions', () => {
    it('clears list and shows error toast when metadata read fails', async () => {
      const projectStore = makeProjectStoreMock();
      projectStore.getFileMetadata.mockRejectedValue(new Error('disk error'));
      const deps = createMockDeps({ projectStore });
      const backup = createTimelineBackupModule(deps);
      backup.backupVersions.value = [
        { type: 'main', name: 'stale', path: 'x', date: null, size: null, label: 'x' },
      ];

      await backup.loadBackupVersions();

      expect(backup.backupVersions.value).toEqual([]);
      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.backups.loadError',
          color: 'error',
        }),
      );
    });
  });

  describe('openVersionForPreview', () => {
    it('clears selection and selection-range when entering preview', async () => {
      const clearSelection = vi.fn();
      const removeSelectionRange = vi.fn();
      const deps = createMockDeps({
        readTimelineFile: vi.fn().mockResolvedValue({
          text: '{"tracks":[]}',
          lastModified: 1000,
          size: 13,
        }),
        clearSelection,
        removeSelectionRange,
      });
      const backup = createTimelineBackupModule(deps);

      await backup.openVersionForPreview({
        type: 'main',
        name: 'clip.otio',
        path: 'project/clip.otio',
        date: new Date(),
        size: 10,
        label: 'Main',
      });

      expect(deps.previewMode.value).toBe(true);
      expect(clearSelection).toHaveBeenCalledOnce();
      expect(removeSelectionRange).toHaveBeenCalledOnce();
    });
  });

  describe('restoreVersion', () => {
    it('clears selection and selection-range after restoring', async () => {
      const clearSelection = vi.fn();
      const removeSelectionRange = vi.fn();
      const deps = createMockDeps({
        readTimelineFile: vi.fn().mockResolvedValue({
          text: '{"tracks":[]}',
          lastModified: 1000,
          size: 13,
        }),
        clearSelection,
        removeSelectionRange,
      });
      const backup = createTimelineBackupModule(deps);

      await backup.restoreVersion({
        type: 'main',
        name: 'clip.otio',
        path: 'project/clip.otio',
        date: new Date(),
        size: 10,
        label: 'Main',
      });

      expect(deps.previewMode.value).toBe(false);
      expect(clearSelection).toHaveBeenCalledOnce();
      expect(removeSelectionRange).toHaveBeenCalledOnce();
    });
  });

  describe('clearAllBackups', () => {
    it('deletes backups folder recursively and reloads versions', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({ projectStore });
      const backup = createTimelineBackupModule(deps);
      vi.spyOn(backup, 'loadBackupVersions').mockResolvedValue(undefined);

      await backup.clearAllBackups();

      expect(projectStore.deleteByPath).toHaveBeenCalledWith('.fastcat/backups', {
        recursive: true,
      });
      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.backups.clearSuccess',
          color: 'success',
        }),
      );
      expect(backup.loadBackupVersions).toHaveBeenCalledOnce();
    });

    it('does nothing and toast warning if read-only', async () => {
      const projectStore = makeProjectStoreMock();
      const deps = createMockDeps({ projectStore, isReadOnly: ref(true) });
      const backup = createTimelineBackupModule(deps);
      vi.spyOn(backup, 'loadBackupVersions');

      await backup.clearAllBackups();

      expect(projectStore.deleteByPath).not.toHaveBeenCalled();
      expect(deps.toast.add).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'videoEditor.timeline.saveBlockedReadOnlyTitle',
          color: 'warning',
        }),
      );
      expect(backup.loadBackupVersions).not.toHaveBeenCalled();
    });
  });
});
