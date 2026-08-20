import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import { TIMELINES_DIR_NAME, DOCUMENTS_DIR_NAME } from '~/utils/constants';
import {
  createTimelineFormatFromProjectDefaults,
  DEFAULT_TIMELINE_FORMAT,
} from '~/timeline/format';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import type { FileManagerContext } from './fileManagerContext';

export function createFileManagerCreate(ctx: FileManagerContext) {
  const { deps, runWithUiFeedback, notifyFileManagerUpdate, reloadDirectory } = ctx;
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  async function createTimeline(parentPath?: string): Promise<string | null> {
    const createdPath = await runWithUiFeedback({
      action: async () => {
        const createdPath = await createTimelineCommand({
          vfs: deps.vfs,
          timelinesDirName: parentPath ?? TIMELINES_DIR_NAME,
          format: createTimelineFormatFromProjectDefaults(
            deps.getProjectSettings?.().project ?? DEFAULT_TIMELINE_FORMAT,
          ),
        });
        await reloadDirectory(parentPath ?? TIMELINES_DIR_NAME);
        return createdPath;
      },
      defaultErrorMessage: deps.t('timelineCreation.failed'),
      toastTitle: deps.t('timelineCreation.errorTitle'),
      toastDescription: () => deps.t('timelineCreation.failed'),
    });
    if (createdPath) {
      notifyFileManagerUpdate();
      void timelineMediaUsageStore.refreshUsage();
    }
    return createdPath;
  }

  async function createMarkdown(parentPath?: string): Promise<string | null> {
    const createdPath = await runWithUiFeedback({
      action: async () => {
        const dirPath = parentPath && parentPath.trim() !== '' ? parentPath : DOCUMENTS_DIR_NAME;
        const createdPath = await createMarkdownCommand({
          vfs: deps.vfs,
          dirPath,
        });
        await reloadDirectory(dirPath);
        return createdPath;
      },
      defaultErrorMessage: deps.t('videoEditor.fileManager.errors.createDocument'),
      toastTitle: deps.t('videoEditor.fileManager.errors.documentError'),
      toastDescription: () => deps.t('videoEditor.fileManager.errors.createDocument'),
    });
    if (createdPath) {
      notifyFileManagerUpdate();
    }
    return createdPath;
  }

  return { createTimeline, createMarkdown };
}
