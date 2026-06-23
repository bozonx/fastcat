import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveNonOverlappingStartUs, sanitizeFps } from '~/timeline/commands/utils';
import { secondsToUs } from '~/utils/time';
import { withFileIoSlot } from '~/utils/io/io-governor';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { vfs } = useFileManager();

  function resolveInsertStartUs(params: { trackId: string; startUs: number; durationUs: number }) {
    const track = timelineStore.timelineDoc?.tracks.find((item) => item.id === params.trackId);
    if (!track) return params.startUs;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase.fps);
    return resolveNonOverlappingStartUs(track, params.startUs, params.durationUs, fps);
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
      const durationUs = await getInsertDurationUs(entry.path, mediaType);
      if (durationUs === null) continue;
      const trackId = timelineStore.resolveMobileTargetTrackId(targetTrackKind, { durationUs });
      const startUs = resolveInsertStartUs({ trackId, startUs: currentStartUs, durationUs });

      if (mediaType === 'text') {
        const file = await vfs.getFile(entry.path);
        if (file) {
          const text = await withFileIoSlot(() => file.text());
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
