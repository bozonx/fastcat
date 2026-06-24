import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import { TIMELINES_DIR_NAME, DOCUMENTS_DIR_NAME } from '~/utils/constants';
import {
  createTimelineFormatFromProjectDefaults,
  DEFAULT_TIMELINE_FORMAT,
} from '~/timeline/format';
import type { FileManagerContext } from './fileManagerContext';

export function createFileManagerCreate(ctx: FileManagerContext) {
  const { deps, runWithUiFeedback, notifyFileManagerUpdate, reloadDirectory } = ctx;

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
      defaultErrorMessage: 'Failed to create document',
      toastTitle: 'Document error',
      toastDescription: () => 'Failed to create document',
    });
    if (createdPath) {
      notifyFileManagerUpdate();
    }
    return createdPath;
  }

  return { createTimeline, createMarkdown };
}
