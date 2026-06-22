import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument } from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { cloneValue } from '~/utils/clone';
import { useMediaProcessor } from '~/composables/useMediaProcessor';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { TIMELINE_MANAGER_THUMBNAILS } from '~/utils/constants';
import { fitDimensions } from '~/media-processor/media-processor.utils';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
const log = createDevLogger('timeline-thumbnail');

/**
 * Renders a timeline frame to a WebP blob. Returns `null` when the scene has no
 * visual layers. The output is fitted into `maxSize` (long edge) preserving the
 * scene's aspect ratio, so non-16:9 timelines aren't squashed.
 */
export async function renderTimelineThumbnail(params: {
  timelineDoc: TimelineDocument;
  timeUs: number;
  maxSize: number;
  quality: number;
}): Promise<Blob | null> {
  const processor = useMediaProcessor();
  const projectStore = useProjectStore();
  const format = resolveEffectiveTimelineFormat(
    getTimelineFormat(params.timelineDoc),
    projectStore.projectSettings.project,
  );
  const { width, height } = fitDimensions(
    format.width,
    format.height,
    params.maxSize,
    params.maxSize,
  );
  return await processor.extractTimelineFrameBlob({
    timelineDoc: params.timelineDoc,
    timeUs: params.timeUs,
    width,
    height,
    quality: params.quality,
  });
}

/**
 * Renders a full-resolution timeline frame to a WebP blob at EXPORT (ultra)
 * quality: full render scale and the ultra effect/transition sample budgets,
 * matching the export pipeline output. Used by the monitor "create stop-frame
 * snapshot" action so saved frames look identical to an export still.
 */
export async function renderStopFrameWebp(params: {
  timelineDoc: TimelineDocument;
  timeUs: number;
  quality: number;
}): Promise<Blob | null> {
  const processor = useMediaProcessor();
  const projectStore = useProjectStore();
  const format = resolveEffectiveTimelineFormat(
    getTimelineFormat(params.timelineDoc),
    projectStore.projectSettings.project,
  );
  return await processor.extractTimelineFrameBlob({
    timelineDoc: params.timelineDoc,
    timeUs: params.timeUs,
    width: format.width,
    height: format.height,
    quality: params.quality,
    isExport: true,
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
      const durationUs = selectTimelineDurationUs(timelineDoc);
      // Ensure the preview time is strictly inside [0, duration) so the
      // underlying decoder never has to resolve a frame exactly at EOF.
      const previewTimeUs = Math.max(
        0,
        Math.min(Math.round(durationUs / 2), Math.max(0, durationUs - 1)),
      );

      const processor = useMediaProcessor();
      const blob = await processor.extractTimelineFrameBlob({
        timelineDoc,
        timeUs: previewTimeUs,
        maxWidth: TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE,
        maxHeight: TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE,
        quality: TIMELINE_MANAGER_THUMBNAILS.QUALITY,
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
