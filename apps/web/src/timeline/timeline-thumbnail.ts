import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument } from '~/timeline/types';
import { selectTimelineDurationTicks } from '~/timeline/selectors';
import { cloneValue } from '~/utils/clone';
import { useMediaProcessor } from '~/composables/useMediaProcessor';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { TIMELINE_MANAGER_THUMBNAILS } from '~/utils/constants';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
const log = createDevLogger('timeline-thumbnail');

/**
 * Renders a full-resolution timeline frame to a WebP blob at EXPORT (ultra)
 * quality: full render scale and the ultra effect/transition sample budgets,
 * matching the export pipeline output. Used by the monitor "create stop-frame
 * snapshot" action so saved frames look identical to an export still.
 */
export async function renderStopFrameWebp(params: {
  timelineDoc: TimelineDocument;
  timeTicks: number;
  quality: number;
  isTransparent?: boolean;
}): Promise<Blob | null> {
  const processor = useMediaProcessor();
  const projectStore = useProjectStore();
  const format = resolveEffectiveTimelineFormat(
    getTimelineFormat(params.timelineDoc),
    projectStore.projectSettings.project,
  );
  return await processor.extractTimelineFrameBlob({
    timelineDoc: params.timelineDoc,
    timeTicks: params.timeTicks,
    width: format.width,
    height: format.height,
    quality: params.quality,
    isExport: true,
    isTransparent: params.isTransparent,
  });
}

export function generateTimelineThumbnail(params: {
  timelinePath: string;
  timelineDoc: TimelineDocument;
}): void {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  if (!projectStore.currentProjectId || !workspaceStore.hasPersistentStorage) {
    return;
  }

  const projectId = projectStore.currentProjectId;
  const timelinePath = params.timelinePath;
  const timelineDoc = cloneValue(params.timelineDoc);

  void (async () => {
    try {
      const durationTicks = selectTimelineDurationTicks(timelineDoc);
      // Ensure the preview time is strictly inside [0, duration) so the
      // underlying decoder never has to resolve a frame exactly at EOF.
      const previewTimeTicks = Math.max(
        0,
        Math.min(Math.round(durationTicks / 2), Math.max(0, durationTicks - 1)),
      );

      const processor = useMediaProcessor();
      const blob = await processor.extractTimelineFrameBlob({
        timelineDoc,
        timeTicks: previewTimeTicks,
        maxWidth: TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE,
        maxHeight: TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE,
        quality: TIMELINE_MANAGER_THUMBNAILS.QUALITY,
        // A small downscaled still gains nothing from ultra effect/AA sampling; the
        // cheapest tier keeps this off the save hot path. The scene is already built
        // and rendered at thumbnail resolution (no supersample-then-shrink).
        effectQuality: 'low',
      });
      if (!blob) return;

      await fileThumbnailGenerator.saveManualThumbnail({
        projectId,
        projectRelativePath: timelinePath,
        blob,
      });
    } catch (error) {
      log.error('Failed to prepare background timeline thumbnail generation:', error);
    }
  })();
}
