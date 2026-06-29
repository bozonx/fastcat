import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { secondsToUs } from '~/utils/time';
import { withFileIoSlot } from '~/utils/io/io-governor';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { vfs } = useFileManager();
  const { t } = useI18n();
  const toast = useToast();

  function resolveInsertStartUs(params: { trackId: string; startUs: number; durationUs: number }) {
    return params.startUs;
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
          try {
            const text = await withFileIoSlot(() => file.text());
            await timelineStore.addVirtualClipToTrack({
              trackId,
              startUs,
              clipType: 'text',
              name: entry.name,
              text,
            });
            if (timelineStore.lastClipTrimmed) {
              toast.add({
                title: t('fastcat.timeline.clipTrimmedToFitGap'),
                color: 'warning',
                icon: 'i-heroicons-exclamation-triangle',
              });
            }
            anyAdded = true;
            currentStartUs = startUs + durationUs;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === 'cannot_insert_on_clip') {
              toast.add({
                title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
                color: 'error',
                icon: 'i-heroicons-x-circle',
              });
            } else {
              toast.add({
                title: t('common.error'),
                description: message,
                color: 'error',
              });
            }
          }
        }
      } else {
        try {
          const result = await timelineStore.addClipToTimelineFromPath({
            trackId,
            name: entry.name,
            path: entry.path,
            startUs,
          });
          if (result.warnings?.some((w) => w.type === 'clipTrimmed')) {
            toast.add({
              title: t('fastcat.timeline.clipTrimmedToFitGap'),
              color: 'warning',
              icon: 'i-heroicons-exclamation-triangle',
            });
          }
          anyAdded = true;
          currentStartUs = startUs + (result.durationUs || durationUs);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message === 'cannot_insert_on_clip') {
            toast.add({
              title: t('fastcat.timeline.cannotInsertPlayheadOnClip'),
              color: 'error',
              icon: 'i-heroicons-x-circle',
            });
          } else {
            toast.add({
              title: t('common.error'),
              description: message,
              color: 'error',
            });
          }
        }
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
