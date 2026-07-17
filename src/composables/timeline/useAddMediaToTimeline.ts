import { useTimelineStore } from '~/stores/timeline.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { secondsToTicksClamped } from '~/utils/time';
import { checkFileTimelineCompatibility } from '~/utils/media/compatibility';
import { useMediaTrackRedirectToast } from '~/composables/timeline/useMediaTrackRedirectToast';

export interface AddMediaToTimelineEntry {
  name: string;
  path?: string;
}

export interface AddMediaToTimelineOptions {
  targetTrackId?: string;
  notifyRedirect?: boolean;
  save?: boolean;
}

export function useAddMediaToTimeline() {
  const timelineStore = useTimelineStore();
  const mediaStore = useMediaStore();
  const workspaceStore = useWorkspaceStore();
  const { captureSelectionKind, notifyRedirect } = useMediaTrackRedirectToast();
  const { t } = useI18n();
  const toast = useToast();

  function resolveInsertStartTicks(params: {
    trackId: string;
    startTicks: number;
    durationTicks: number;
  }) {
    return params.startTicks;
  }

  /**
   * Returns null when metadata extraction failed (so the caller can skip this file
   * gracefully instead of inserting a clip with an arbitrary fallback duration that
   * would later fail or display as a broken image).
   */
  async function getInsertDurationTicks(path: string, mediaType: string): Promise<number | null> {
    if (mediaType === 'image' || mediaType === 'timeline') {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationTicks;
    }

    const meta = await mediaStore.getOrFetchMetadataByPath(path);
    if (!meta || meta.error) return null;
    if (meta.duration) return Math.max(1, secondsToTicksClamped(meta.duration));

    return null;
  }

  async function addMediaToTimeline(
    entries: AddMediaToTimelineEntry[],
    options: AddMediaToTimelineOptions = {},
  ) {
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
    const addedKinds: ('video' | 'audio')[] = [];
    const selectionKind = options.notifyRedirect === false ? null : captureSelectionKind();

    for (const entry of entries) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name || entry.path);

      if (mediaType === 'unknown' || mediaType === 'text') continue;

      const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
      const durationTicks = await getInsertDurationTicks(entry.path, mediaType);
      if (durationTicks === null) continue;
      const trackId =
        options.targetTrackId ??
        timelineStore.resolveMobileTargetTrackId(targetTrackKind, {
          durationTicks,
          startTicks: currentStartTicks,
        });
      const startTicks = resolveInsertStartTicks({
        trackId,
        startTicks: currentStartTicks,
        durationTicks,
      });

      try {
        const result =
          mediaType === 'timeline'
            ? await timelineStore.addTimelineClipToTimelineFromPath({
                trackId,
                name: entry.name,
                path: entry.path,
                startTicks,
              })
            : await timelineStore.addClipToTimelineFromPath({
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
        const placedKind =
          timelineStore.timelineDoc?.tracks.find((track) => track.id === trackId)?.kind ??
          targetTrackKind;
        addedKinds.push(placedKind);
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

    if (anyAdded && options.save !== false) {
      await timelineStore.requestTimelineSave({ immediate: true });
    }

    notifyRedirect(selectionKind, addedKinds);

    return anyAdded;
  }

  return {
    addMediaToTimeline,
  };
}
