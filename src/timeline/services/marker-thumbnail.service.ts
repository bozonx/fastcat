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
  timeTicks: number;
  timelineDoc: TimelineDocument;
  /**
   * Receives the raw rendered frame. The caller creates and owns the object URL so
   * URL lifetime is per-consumer (see MarkerThumbnail.vue) — the generator never
   * hands out a shared URL that another instance could revoke.
   */
  onComplete?: (blob: Blob) => void;
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
          timeTicks: params.timeTicks,
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

        // Persist for later loads; the URL is created and owned by the consumer.
        await fileThumbnailGenerator.saveMarkerThumbnail({
          projectId: params.projectId,
          markerId: params.markerId,
          timeTicks: params.timeTicks,
          blob,
        });

        params.onComplete?.(blob);
      } catch (error) {
        log.error('Failed to generate marker thumbnail:', params.markerId, error);
        params.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    priority: MEDIA_TASK_PRIORITIES.markerThumbnail,
  });
}
