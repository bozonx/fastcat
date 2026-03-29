import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const { vfs } = useFileManager();

  async function addMediaToTimeline(entries: { name: string; path?: string }[]) {
    if (!entries.length) return;

    const startUs = timelineStore.currentTime;
    let anyAdded = false;

    for (const entry of entries) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name);

      if (mediaType === 'unknown') continue;

      const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
      const tracks = timelineStore.timelineDoc?.tracks || [];
      const trackId = tracks.find((t) => t.kind === targetTrackKind)?.id;

      if (!trackId) continue;

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
        }
      } else {
        await timelineStore.addClipToTimelineFromPath({
          trackId,
          name: entry.name,
          path: entry.path,
          startUs,
        });
        anyAdded = true;
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
