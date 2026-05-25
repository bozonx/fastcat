import { ref, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';
import { runResilientFileWrite, withFileIoSlot } from '~/utils/io/io-governor';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { getNextBackupName, getBackupsToDelete, getBackupNumber } from '~/utils/timeline-backup';

/**
 * A restorable timeline snapshot listed in the backups UI: the main file, the
 * autosave copy, or a numbered backup.
 */
export interface TimelineBackupVersion {
  type: 'main' | 'autosave' | 'backup';
  name: string;
  path: string;
  date: Date | null;
  size: number | null;
  label: string;
}

/** Info banner state shown while previewing a backup/autosave version. */
export interface TimelinePreviewBackupInfo {
  type: 'main' | 'autosave' | 'backup';
  name: string;
  path: string;
  timestamp: number;
}

export interface TimelineBackupDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTimelinePath: Ref<string | null>;
  duration: Ref<number>;
  currentTime: Ref<number>;
  previewMode: Ref<boolean>;
  previewBackupInfo: Ref<TimelinePreviewBackupInfo | null>;
  projectStore: {
    getDirectoryHandleByPath: (
      path: string,
      options?: { create?: boolean },
    ) => Promise<FileSystemDirectoryHandle | null>;
    getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
    createFallbackTimelineDoc: () => TimelineDocument;
  };
  workspaceStore: {
    userSettings: { backup?: { enabled?: boolean; count: number } };
  };
  toast: AppNotificationService;
  t: I18nService['t'];
  loadTimeline: () => Promise<void>;
  deleteTimelineAutosaveFile: (timelinePath: string) => Promise<void>;
  ensureTimelineFileHandle: (options?: {
    create?: boolean;
    relativePath?: string;
  }) => Promise<FileSystemFileHandle | null>;
  markTimelineAsDirty: () => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
}

export interface TimelineBackupModule {
  backupVersions: Ref<TimelineBackupVersion[]>;
  handleBackup: (serialized: string) => Promise<void>;
  exitPreviewAndReload: () => Promise<void>;
  restorePreviewVersion: () => Promise<void>;
  openVersionForPreview: (version: TimelineBackupVersion) => Promise<void>;
  restoreVersion: (version: TimelineBackupVersion) => Promise<void>;
  deleteBackupVersion: (version: TimelineBackupVersion) => Promise<void>;
  loadBackupVersions: () => Promise<void>;
}

/**
 * Owns the timeline backup history and version preview/restore flow. Explicit
 * saves rotate numbered backups; the backups UI lists the main file, autosave
 * and backups, and can preview or restore any of them.
 */
export function createTimelineBackupModule(deps: TimelineBackupDeps): TimelineBackupModule {
  const backupVersions = ref<TimelineBackupVersion[]>([]);

  // Backups are a history of EXPLICIT saves (for rollback), so one is taken on
  // every manual save — `handleBackup` is only wired into `onSaveSuccess`, which
  // fires from `saveTimeline`, never from the periodic crash-recovery autosave.
  // `backup.enabled` is the on/off toggle; `backup.count` controls rotation.
  async function handleBackup(serialized: string) {
    if (!deps.currentTimelinePath.value) return;
    const backupSettings = deps.workspaceStore.userSettings.backup;
    if (!backupSettings || !backupSettings.enabled) return;

    try {
      const pathParts = deps.currentTimelinePath.value.split('/');
      const fileName = pathParts.pop();
      if (!fileName) return;

      const baseName = fileName.replace(/\.otio$/, '');
      const dirPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';

      const backupDirStr = `.fastcat/backups/${dirPath}`;

      const backupDirHandle = await deps.projectStore.getDirectoryHandleByPath(backupDirStr, {
        create: true,
      });
      if (!backupDirHandle) return;

      const existingBackupNames: string[] = [];
      for await (const [name, handle] of (
        backupDirHandle as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }
      ).entries()) {
        if (
          handle.kind === 'file' &&
          name.startsWith(baseName + '__bak') &&
          name.endsWith('.otio')
        ) {
          existingBackupNames.push(name);
        }
      }

      const nextName = getNextBackupName(baseName, existingBackupNames);

      const newHandle = await backupDirHandle.getFileHandle(nextName, { create: true });
      await runResilientFileWrite(async () => {
        const writable = await (
          newHandle as unknown as {
            createWritable: () => Promise<{
              write: (data: string) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }
        ).createWritable();
        await writable.write(serialized);
        await writable.close();
      });

      const toDelete = getBackupsToDelete(existingBackupNames, backupSettings.count);
      for (const name of toDelete) {
        try {
          await backupDirHandle.removeEntry(name);
        } catch (e) {
          console.warn('Failed to delete old backup', e);
        }
      }
    } catch (e) {
      console.error('Failed to create timeline backup', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backupError'),
        description: deps.t('videoEditor.timeline.backupErrorDesc'),
        color: 'warning',
      });
    }
  }

  async function exitPreviewAndReload() {
    deps.previewMode.value = false;
    deps.previewBackupInfo.value = null;
    await deps.loadTimeline();
  }

  async function restorePreviewVersion() {
    if (!deps.timelineDoc.value) return;
    deps.previewMode.value = false;
    deps.previewBackupInfo.value = null;
    deps.markTimelineAsDirty();
    if (deps.currentTimelinePath.value) {
      await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
    }
    await deps.requestTimelineSave({ immediate: true });
    deps.toast.add({
      title: deps.t('videoEditor.timeline.backups.versionRestored'),
      color: 'success',
    });
  }

  async function openVersionForPreview(version: TimelineBackupVersion) {
    if (!deps.currentTimelinePath.value) return;
    try {
      let file: File | null = null;
      if (version.type === 'main') {
        const handle = await deps.ensureTimelineFileHandle({ create: false });
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      } else if (version.type === 'autosave') {
        const handle = await deps.ensureTimelineFileHandle({
          create: false,
          relativePath: `.fastcat/autosave/${deps.currentTimelinePath.value}`,
        });
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      } else {
        const handle = await deps.projectStore.getFileHandleByPath(version.path);
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      }

      if (!file) throw new Error('File not found');
      const text = await withFileIoSlot(() => file.text());

      const fallback = deps.projectStore.createFallbackTimelineDoc();
      const parsed = parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: fallback.metadata?.fastcat?.format ?? { fps: fallback.timebase.fps },
      });

      deps.timelineDoc.value = parsed;
      deps.previewMode.value = true;
      deps.previewBackupInfo.value = {
        type: version.type,
        name: version.label,
        path: version.path,
        timestamp: version.date?.getTime() || Date.now(),
      };

      deps.duration.value = selectTimelineDurationUs(parsed);
      deps.currentTime.value = 0;
    } catch (e) {
      console.error('Failed to open version for preview', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.previewLoadError'),
        color: 'error',
      });
    }
  }

  async function restoreVersion(version: TimelineBackupVersion) {
    try {
      let file: File | null = null;
      if (version.type === 'main') {
        const handle = await deps.ensureTimelineFileHandle({ create: false });
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      } else if (version.type === 'autosave') {
        const handle = await deps.ensureTimelineFileHandle({
          create: false,
          relativePath: `.fastcat/autosave/${deps.currentTimelinePath.value}`,
        });
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      } else {
        const handle = await deps.projectStore.getFileHandleByPath(version.path);
        if (handle) file = await withFileIoSlot(() => handle.getFile());
      }

      if (!file) throw new Error('File not found');
      const text = await withFileIoSlot(() => file.text());

      const fallback = deps.projectStore.createFallbackTimelineDoc();
      const parsed = parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: fallback.metadata?.fastcat?.format ?? { fps: fallback.timebase.fps },
      });

      deps.timelineDoc.value = parsed;
      deps.previewMode.value = false;
      deps.previewBackupInfo.value = null;

      deps.duration.value = selectTimelineDurationUs(parsed);
      deps.currentTime.value = 0;

      deps.markTimelineAsDirty();

      if (deps.currentTimelinePath.value) {
        await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
      }
      await deps.requestTimelineSave({ immediate: true });

      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.versionRestored'),
        color: 'success',
      });
      await loadBackupVersions();
    } catch (e) {
      console.error('Failed to restore version', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.restoreError'),
        color: 'error',
      });
    }
  }

  async function deleteBackupVersion(version: TimelineBackupVersion) {
    try {
      if (version.type === 'autosave') {
        if (deps.currentTimelinePath.value) {
          await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
        }
      } else if (version.type === 'backup') {
        const pathParts = version.path.split('/');
        const fileName = pathParts.pop();
        if (!fileName) return;
        const dirPath = pathParts.join('/');
        const dirHandle = await deps.projectStore.getDirectoryHandleByPath(dirPath, {
          create: false,
        });
        if (dirHandle) {
          await dirHandle.removeEntry(fileName);
        }
      }
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.versionDeleted'),
        color: 'success',
      });
      await loadBackupVersions();
    } catch (e) {
      console.error('Failed to delete version', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.deleteError'),
        color: 'error',
      });
    }
  }

  async function loadBackupVersions() {
    if (!deps.currentTimelinePath.value) {
      backupVersions.value = [];
      return;
    }
    const list: TimelineBackupVersion[] = [];
    try {
      // 1. Main file
      const mainHandle = await deps.ensureTimelineFileHandle({ create: false });
      if (mainHandle) {
        const file = await withFileIoSlot(() => mainHandle.getFile());
        list.push({
          type: 'main',
          name: deps.currentTimelinePath.value.split('/').pop() || deps.currentTimelinePath.value,
          path: deps.currentTimelinePath.value,
          date: new Date(file.lastModified),
          size: file.size,
          label: deps.t('videoEditor.timeline.backups.mainFile'),
        });
      }

      // 2. Autosave
      const autosaveHandle = await deps.ensureTimelineFileHandle({
        create: false,
        relativePath: `.fastcat/autosave/${deps.currentTimelinePath.value}`,
      });
      if (autosaveHandle) {
        const file = await withFileIoSlot(() => autosaveHandle.getFile());
        list.push({
          type: 'autosave',
          name: 'autosave',
          path: `.fastcat/autosave/${deps.currentTimelinePath.value}`,
          date: new Date(file.lastModified),
          size: file.size,
          label: deps.t('videoEditor.timeline.backups.autosave'),
        });
      }

      // 3. Backups
      const pathParts = deps.currentTimelinePath.value.split('/');
      const fileName = pathParts.pop();
      if (fileName) {
        const baseName = fileName.replace(/\.otio$/, '');
        const dirPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';
        const backupDirStr = `.fastcat/backups/${dirPath}`;
        const backupDirHandle = await deps.projectStore.getDirectoryHandleByPath(backupDirStr, {
          create: false,
        });

        if (backupDirHandle) {
          const files: { name: string; handle: FileSystemFileHandle }[] = [];
          for await (const [name, handle] of (
            backupDirHandle as unknown as {
              entries: () => AsyncIterable<[string, FileSystemHandle]>;
            }
          ).entries()) {
            if (
              handle.kind === 'file' &&
              name.startsWith(baseName + '__bak') &&
              name.endsWith('.otio')
            ) {
              files.push({ name, handle: handle as FileSystemFileHandle });
            }
          }

          files.sort((a, b) => {
            const numA = getBackupNumber(a.name) || 0;
            const numB = getBackupNumber(b.name) || 0;
            return numB - numA;
          });

          for (const item of files) {
            const file = await withFileIoSlot(() => item.handle.getFile());
            const num = getBackupNumber(item.name);
            list.push({
              type: 'backup',
              name: item.name,
              path: `${backupDirStr}${item.name}`,
              date: new Date(file.lastModified),
              size: file.size,
              label: deps.t('videoEditor.timeline.backups.backupNum', {
                num: num !== null ? `#${num}` : item.name,
              }),
            });
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load backup versions', e);
    }
    backupVersions.value = list;
  }

  return {
    backupVersions,
    handleBackup,
    exitPreviewAndReload,
    restorePreviewVersion,
    openVersionForPreview,
    restoreVersion,
    deleteBackupVersion,
    loadBackupVersions,
  };
}
