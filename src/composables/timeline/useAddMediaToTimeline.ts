import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { vfs } = useFileManager();

  function resolveInsertStartUs(params: { trackId: string; startUs: number; durationUs: number }) {
    const track = timelineStore.timelineDoc?.tracks.find((item) => item.id === params.trackId);
    if (!track) return params.startUs;

    let nextStartUs = Math.max(0, Math.round(params.startUs));

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;

      const itemStartUs = item.timelineRange.startUs;
      const itemEndUs = itemStartUs + item.timelineRange.durationUs;
      const nextEndUs = nextStartUs + params.durationUs;

      if (nextEndUs <= itemStartUs || nextStartUs >= itemEndUs) {
        continue;
      }

      nextStartUs = itemEndUs;
    }

    return nextStartUs;
  }

  async function getInsertDurationUs(path: string, mediaType: string) {
    if (mediaType === 'text' || mediaType === 'image') {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    }

    const meta = await mediaStore.getOrFetchMetadataByPath(path);
    if (meta?.duration) return Math.max(1, Math.round(meta.duration * 1_000_000));

    return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
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
