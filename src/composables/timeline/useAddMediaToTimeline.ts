import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { secondsToTicksClamped } from '~/utils/time';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { checkFileTimelineCompatibility } from '~/utils/media/compatibility';

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { vfs } = useFileManager();
  const { t } = useI18n();
  const toast = useToast();

  function resolveInsertStartTicks(params: { trackId: string; startTicks: number; durationTicks: number }) {
    return params.startTicks;
  }

  /**
   * Returns null when metadata extraction failed (so the caller can skip this file
   * gracefully instead of inserting a clip with an arbitrary fallback duration that
   * would later fail or display as a broken image).
   */
  async function getInsertDurationTicks(path: string, mediaType: string): Promise<number | null> {
    if (mediaType === 'text' || mediaType === 'image') {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
    }

    const meta = await mediaStore.getOrFetchMetadataByPath(path);
    if (!meta || meta.error) return null;
    if (meta.duration) return Math.max(1, secondsToTicksClamped(meta.duration));

    return null;
  }

  async function addMediaToTimeline(entries: { name: string; path?: string }[]) {
    if (!entries.length) return;

    for (const entry of entries) {
      const compat = checkFileTimelineCompatibility(entry, mediaStore);
      if (!compat.compatible) {
        const errorMsg = compat.reasonKey ? t(compat.reasonKey) : t('common.error');
        toast.add({
          color: 'error',
          title: t('common.error'),
          description: errorMsg,
          icon: 'i-heroicons-x-circle',
        });
        return false;
      }
    }

    let currentStartTicks = timelineStore.currentTime;
    let anyAdded = false;

    for (const entry of entries) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name || entry.path);

      if (mediaType === 'unknown') continue;

      const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
      const durationTicks = await getInsertDurationTicks(entry.path, mediaType);
      if (durationTicks === null) continue;
      const trackId = timelineStore.resolveMobileTargetTrackId(targetTrackKind, { durationTicks });
      const startTicks = resolveInsertStartTicks({ trackId, startTicks: currentStartTicks, durationTicks });

      if (mediaType === 'text') {
        const file = await vfs.getFile(entry.path);
        if (file) {
          try {
            const text = await withFileIoSlot(() => file.text());
            await timelineStore.addVirtualClipToTrack({
              trackId,
              startTicks,
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
            currentStartTicks = startTicks + durationTicks;
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
            startTicks,
          });
          if (result.warnings?.some((w) => w.type === 'clipTrimmed')) {
            toast.add({
              title: t('fastcat.timeline.clipTrimmedToFitGap'),
              color: 'warning',
              icon: 'i-heroicons-exclamation-triangle',
            });
          }
          anyAdded = true;
          currentStartTicks = startTicks + (result.durationTicks || durationTicks);
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
