import { createDevLogger } from '~/utils/dev-logger';
import { ref, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { getNextBackupName, getBackupsToDelete, getBackupNumber } from '~/utils/timeline-backup';
const log = createDevLogger('backup');

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
  isReadOnly?: Ref<boolean>;
  projectStore: {
    readTextByPath: (path: string) => Promise<string | null>;
    writeTextByPath: (path: string, text: string) => Promise<void>;
    deleteByPath: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    listEntryNames: (path: string) => Promise<string[]>;
    getFileMetadata: (path: string) => Promise<{ lastModified: number; size: number } | null>;
    createFallbackTimelineDoc: () => TimelineDocument;
  };
  workspaceStore: {
    userSettings: { backup?: { enabled?: boolean; count: number } };
  };
  toast: AppNotificationService;
  t: I18nService['t'];
  loadTimeline: () => Promise<void>;
  deleteTimelineAutosaveFile: (timelinePath: string) => Promise<void>;
  readTimelineFile: (
    relativePath: string,
  ) => Promise<{ text: string; lastModified: number; size: number } | null>;
  markTimelineAsDirty: () => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  saveTimeline: () => Promise<void>;
  clearSelection?: () => void;
  removeSelectionRange?: () => void;
}

export interface TimelineBackupModule {
  backupVersions: Ref<TimelineBackupVersion[]>;
  handleBackup: (serialized: string) => Promise<void>;
  preserveAndDiscardAutosave: (timelinePath: string) => Promise<void>;
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

  async function readVersionText(version: TimelineBackupVersion): Promise<string> {
    let text: string | null = null;
    if (version.type === 'main') {
      const r = await withFileIoSlot(() => deps.readTimelineFile(deps.currentTimelinePath.value!));
      text = r?.text ?? null;
    } else if (version.type === 'autosave') {
      const r = await withFileIoSlot(() =>
        deps.readTimelineFile(`.fastcat/autosave/${deps.currentTimelinePath.value}`),
      );
      text = r?.text ?? null;
    } else {
      text = await withFileIoSlot(() => deps.projectStore.readTextByPath(version.path));
    }
    if (!text) throw new Error('File not found');
    return text;
  }

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

      const allNames = await deps.projectStore.listEntryNames(backupDirStr);
      const existingBackupNames = allNames.filter(
        (n) => n.startsWith(baseName + '__bak') && n.endsWith('.otio'),
      );

      const nextName = getNextBackupName(baseName, existingBackupNames);
      await withFileIoSlot(() =>
        deps.projectStore.writeTextByPath(`${backupDirStr}${nextName}`, serialized),
      );

      const toDelete = getBackupsToDelete(existingBackupNames, backupSettings.count);
      for (const name of toDelete) {
        try {
          await deps.projectStore.deleteByPath(`${backupDirStr}${name}`);
        } catch (e) {
          log.warn('Failed to delete old backup', e);
        }
      }
    } catch (e) {
      log.error('Failed to create timeline backup', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backupError'),
        description: deps.t('videoEditor.timeline.backupErrorDesc'),
        color: 'warning',
      });
    }
  }

  // Crash-recovery discard path: the user chose to open the saved version and
  // drop the newer unsaved sidecar. Rather than deleting it outright, rotate its
  // content into the numbered backups (best-effort, subject to the backup
  // toggle) so the unsaved state stays inspectable/restorable in the Backups
  // tab, then remove the sidecar so it isn't re-offered on the next launch.
  async function preserveAndDiscardAutosave(timelinePath: string) {
    try {
      const r = await withFileIoSlot(() =>
        deps.readTimelineFile(`.fastcat/autosave/${timelinePath}`),
      );
      if (r?.text) await handleBackup(r.text);
    } catch (e) {
      log.warn('Failed to preserve autosave as backup before discarding', e);
    }
    await deps.deleteTimelineAutosaveFile(timelinePath);
  }

  async function exitPreviewAndReload() {
    deps.previewMode.value = false;
    deps.previewBackupInfo.value = null;
    await deps.loadTimeline();
  }

  async function restorePreviewVersion() {
    if (!deps.timelineDoc.value) return;
    if (deps.isReadOnly?.value) {
      deps.toast.add({
        title: deps.t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: deps.previewMode.value
          ? deps.t('videoEditor.timeline.saveBlockedPreviewDesc')
          : deps.t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
      return;
    }
    deps.previewMode.value = false;
    deps.previewBackupInfo.value = null;
    deps.markTimelineAsDirty();
    if (deps.currentTimelinePath.value) {
      await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
    }
    await deps.saveTimeline();
    deps.toast.add({
      title: deps.t('videoEditor.timeline.backups.versionRestored'),
      color: 'success',
    });
  }

  async function openVersionForPreview(version: TimelineBackupVersion) {
    if (!deps.currentTimelinePath.value) return;
    try {
      const text = await readVersionText(version);

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

      deps.clearSelection?.();
      deps.removeSelectionRange?.();

      deps.duration.value = selectTimelineDurationUs(parsed);
      deps.currentTime.value = 0;
    } catch (e) {
      log.error('Failed to open version for preview', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.previewLoadError'),
        color: 'error',
      });
    }
  }

  async function restoreVersion(version: TimelineBackupVersion) {
    if (deps.isReadOnly?.value) {
      deps.toast.add({
        title: deps.t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: deps.previewMode.value
          ? deps.t('videoEditor.timeline.saveBlockedPreviewDesc')
          : deps.t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
      return;
    }
    try {
      const text = await readVersionText(version);

      const fallback = deps.projectStore.createFallbackTimelineDoc();
      const parsed = parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        format: fallback.metadata?.fastcat?.format ?? { fps: fallback.timebase.fps },
      });

      deps.timelineDoc.value = parsed;
      deps.previewMode.value = false;
      deps.previewBackupInfo.value = null;

      deps.clearSelection?.();
      deps.removeSelectionRange?.();

      deps.duration.value = selectTimelineDurationUs(parsed);
      deps.currentTime.value = 0;

      deps.markTimelineAsDirty();

      if (deps.currentTimelinePath.value) {
        await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
      }
      await deps.saveTimeline();

      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.versionRestored'),
        color: 'success',
      });
      await loadBackupVersions();
    } catch (e) {
      log.error('Failed to restore version', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.restoreError'),
        color: 'error',
      });
    }
  }

  async function deleteBackupVersion(version: TimelineBackupVersion) {
    if (deps.isReadOnly?.value) {
      deps.toast.add({
        title: deps.t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: deps.previewMode.value
          ? deps.t('videoEditor.timeline.saveBlockedPreviewDesc')
          : deps.t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
      return;
    }
    try {
      if (version.type === 'autosave') {
        if (deps.currentTimelinePath.value) {
          await deps.deleteTimelineAutosaveFile(deps.currentTimelinePath.value);
        }
      } else if (version.type === 'backup') {
        await deps.projectStore.deleteByPath(version.path);
      } else {
        log.warn('Cannot delete main file version', version);
        deps.toast.add({
          title: deps.t('videoEditor.timeline.backups.cannotDeleteMain'),
          color: 'warning',
        });
        return;
      }
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.versionDeleted'),
        color: 'success',
      });
      await loadBackupVersions();
    } catch (e) {
      log.error('Failed to delete version', e);
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
      const mainMeta = await deps.projectStore.getFileMetadata(deps.currentTimelinePath.value);
      if (mainMeta) {
        list.push({
          type: 'main',
          name: deps.currentTimelinePath.value.split('/').pop() || deps.currentTimelinePath.value,
          path: deps.currentTimelinePath.value,
          date: new Date(mainMeta.lastModified),
          size: mainMeta.size,
          label: deps.t('videoEditor.timeline.backups.mainFile'),
        });
      }

      // 2. Autosave
      const autosavePath = `.fastcat/autosave/${deps.currentTimelinePath.value}`;
      const autosaveMeta = await deps.projectStore.getFileMetadata(autosavePath);
      if (autosaveMeta) {
        list.push({
          type: 'autosave',
          name: 'autosave',
          path: autosavePath,
          date: new Date(autosaveMeta.lastModified),
          size: autosaveMeta.size,
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
        const allNames = await deps.projectStore.listEntryNames(backupDirStr);
        const backupNames = allNames
          .filter((n) => n.startsWith(baseName + '__bak') && n.endsWith('.otio'))
          .sort((a, b) => (getBackupNumber(b) || 0) - (getBackupNumber(a) || 0));

        const backupEntries = await Promise.all(
          backupNames.map(async (name) => {
            const meta = await deps.projectStore.getFileMetadata(`${backupDirStr}${name}`);
            const num = getBackupNumber(name);
            return {
              type: 'backup' as const,
              name,
              path: `${backupDirStr}${name}`,
              date: meta ? new Date(meta.lastModified) : null,
              size: meta?.size ?? null,
              label: deps.t('videoEditor.timeline.backups.backupNum', {
                num: num !== null ? `#${num}` : name,
              }),
            };
          }),
        );
        list.push(...backupEntries);
      }
    } catch (e) {
      log.warn('Failed to load backup versions', e);
      deps.toast.add({
        title: deps.t('videoEditor.timeline.backups.loadError'),
        color: 'error',
      });
      backupVersions.value = [];
      return;
    }
    backupVersions.value = list;
  }

  return {
    backupVersions,
    handleBackup,
    preserveAndDiscardAutosave,
    exitPreviewAndReload,
    restorePreviewVersion,
    openVersionForPreview,
    restoreVersion,
    deleteBackupVersion,
    loadBackupVersions,
  };
}
