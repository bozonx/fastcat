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
    createFallbackTimelineDoc: vi.fn(),
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
    projectStore: makeProjectStoreMock(),
    workspaceStore: { userSettings: { backup: { enabled: true, count: 5 } } },
    toast: { add: vi.fn() },
    t: ((key: string) => key) as TimelineBackupDeps['t'],
    loadTimeline: vi.fn().mockResolvedValue(undefined),
    deleteTimelineAutosaveFile: vi.fn().mockResolvedValue(undefined),
    readTimelineFile: vi.fn().mockResolvedValue(null),
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

    it('lists the main file and autosave when both exist', async () => {
      const files: Record<string, FileMeta> = {
        'project/clip.otio': { text: 'main', lastModified: 1000 },
        '.fastcat/autosave/project/clip.otio': { text: 'autosave', lastModified: 2000 },
      };
      const deps = createMockDeps({ projectStore: makeProjectStoreMock(files) });
      const backup = createTimelineBackupModule(deps);

      await backup.loadBackupVersions();

      expect(backup.backupVersions.value.map((v) => v.type)).toEqual(['main', 'autosave']);
      const main = backup.backupVersions.value[0];
      expect(main.path).toBe('project/clip.otio');
      expect(main.size).toBe(4); // 'main'.length
      expect(backup.backupVersions.value[1].path).toBe('.fastcat/autosave/project/clip.otio');
    });
  });

  describe('handleBackup', () => {
    it('does nothing when backups are disabled', async () => {
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

    it('writes a backup file when enabled', async () => {
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
      expect(deps.requestTimelineSave).not.toHaveBeenCalled();
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
});
