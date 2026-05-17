import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import { secondsToUs } from '~/utils/time';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { vfs } = useFileManager();

  function resolveInsertStartUs(params: { trackId: string; startUs: number; durationUs: number }) {
    const track = timelineStore.timelineDoc?.tracks.find((item) => item.id === params.trackId);
    if (!track) return params.startUs;

    // Quantize candidate to the same frame grid that addClipToTrack will use, so the
    // collision search below operates in the final coordinate space and we cannot end
    // up overlapping a neighbour clip due to post-quantization rounding.
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase.fps);
    let nextStartUs = quantizeTimeUsToFrames(Math.max(0, params.startUs), fps, 'round');
    const durationUs = quantizeTimeUsToFrames(Math.max(0, params.durationUs), fps, 'round');

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;

      const itemStartUs = item.timelineRange.startUs;
      const itemEndUs = itemStartUs + item.timelineRange.durationUs;
      const nextEndUs = nextStartUs + durationUs;

      if (nextEndUs <= itemStartUs || nextStartUs >= itemEndUs) {
        continue;
      }

      nextStartUs = quantizeTimeUsToFrames(itemEndUs, fps, 'ceil');
    }

    return nextStartUs;
  }

  /**
   * Returns null when metadata extraction failed (so the caller can skip this file
   * gracefully instead of inserting a clip with an arbitrary fallback duration that
   * would later fail or display as a broken image).
   */
  async function getInsertDurationUs(path: string, mediaType: string): Promise<number | null> {
    if (mediaType === 'text' || mediaType === 'image') {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    }

    const meta = await mediaStore.getOrFetchMetadataByPath(path);
    if (!meta || meta.error) return null;
    if (meta.duration) return Math.max(1, secondsToUs(meta.duration));

    return null;
  }

  async function addMediaToTimeline(entries: { name: string; path?: string }[]) {
    if (!entries.length) return;

    let currentStartUs = timelineStore.currentTime;
    let anyAdded = false;

    for (const entry of entries) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name || entry.path);

      if (mediaType === 'unknown') continue;

      const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
      const tracks = timelineStore.timelineDoc?.tracks || [];
      const trackId = tracks.find((t) => t.kind === targetTrackKind)?.id;

      if (!trackId) continue;

      const durationUs = await getInsertDurationUs(entry.path, mediaType);
      if (durationUs === null) continue;
      const startUs = resolveInsertStartUs({ trackId, startUs: currentStartUs, durationUs });

      if (mediaType === 'text') {
        const file = await vfs.getFile(entry.path);
        if (file) {
          const text = await file.text();
          await timelineStore.addVirtualClipToTrack({
            trackId,
            startUs,
            clipType: 'text',
            name: entry.name,
            text,
          });
          anyAdded = true;
          currentStartUs = startUs + durationUs;
        }
      } else {
        const result = await timelineStore.addClipToTimelineFromPath({
          trackId,
          name: entry.name,
          path: entry.path,
          startUs,
        });
        anyAdded = true;
        currentStartUs = startUs + (result.durationUs || durationUs);
      }
    }

    if (anyAdded) {
      await timelineStore.requestTimelineSave({ immediate: true });
    }

    return anyAdded;
  }

  return {
    addMediaToTimeline,
  };
}
