import { createDevLogger } from '~/utils/dev-logger';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { MARKER_THUMBNAILS } from '~/utils/constants';
import { addLatestMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { useMediaProcessor } from '~/composables/useMediaProcessor';
import type { TimelineDocument } from '~/timeline/types';
const log = createDevLogger('marker-thumbnail.service');

export interface MarkerThumbnailParams {
  projectId: string;
  markerId: string;
  timeUs: number;
  timelineDoc: TimelineDocument;
  onComplete?: (url: string) => void;
  onError?: (err: Error) => void;
}

/**
 * Dispatches marker thumbnail generation to the media task queue.
 */
export function dispatchMarkerThumbnailGeneration(params: MarkerThumbnailParams): void {
  addLatestMediaTask({
    key: `marker-thumbnail:${params.markerId}`,
    task: async () => {
      try {
        const processor = useMediaProcessor();
        const blob = await processor.extractTimelineFrameBlob({
          timelineDoc: params.timelineDoc,
          timeUs: params.timeUs,
          maxWidth: MARKER_THUMBNAILS.WIDTH,
          maxHeight: MARKER_THUMBNAILS.HEIGHT,
          quality: MARKER_THUMBNAILS.QUALITY,
          // Marker previews are tiny stills — render at the cheapest effect/AA tier.
          effectQuality: 'low',
        });

        if (!blob) {
          params.onError?.(new Error('Extracted blob is null'));
          return;
        }

        // saveMarkerThumbnail owns and returns the single object URL for this blob;
        // creating another here would leak the displayed URL.
        const url = await fileThumbnailGenerator.saveMarkerThumbnail({
          projectId: params.projectId,
          markerId: params.markerId,
          timeUs: params.timeUs,
          blob,
        });

        params.onComplete?.(url);
      } catch (error) {
        log.error('Failed to generate marker thumbnail:', params.markerId, error);
        params.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    priority: MEDIA_TASK_PRIORITIES.timelineThumbnailLazy,
  });
}
