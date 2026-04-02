import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';

import { useAppClipboard } from '~/composables/useAppClipboard';

export function useTrackContextMenu(
  options: {
    onRequestDelete?: (track: TimelineTrack) => void;
    onPaste?: (trackId: string) => void;
  } = {},
) {
  const { t } = useI18n();
  const timelineStore = useTimelineStore();
  const clipboardStore = useAppClipboard();
  const hasTimelineClipboard = computed(() => clipboardStore.hasTimelinePayload);

  const getTrackContextMenuItems = (track: TimelineTrack, tracks: TimelineTrack[]) => {
    const kind = track.kind;
    const otherIdx = tracks.filter((tr) => tr.kind === kind).length + 1;

    return [
      [
        {
          label: t('common.paste'),
          icon: 'i-heroicons-clipboard',
          disabled: !hasTimelineClipboard.value,
          onSelect: () => options.onPaste?.(track.id),
        },
      ],
      [
        {
          label: t(`fastcat.timeline.add${kind === 'video' ? 'Video' : 'Audio'}TrackAbove`),
          icon: kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
          onSelect: () =>
            timelineStore.addTrack(kind, `${kind === 'video' ? 'Video' : 'Audio'} ${otherIdx}`, {
              insertBeforeId: track.id,
            }),
        },
        {
          label: t(`fastcat.timeline.add${kind === 'video' ? 'Video' : 'Audio'}TrackBelow`),
          icon: kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
          onSelect: () =>
            timelineStore.addTrack(kind, `${kind === 'video' ? 'Video' : 'Audio'} ${otherIdx}`, {
              insertAfterId: track.id,
            }),
        },
      ],
      [
        {
          label: t('fastcat.timeline.renameTrack'),
          icon: 'i-heroicons-pencil',
          onSelect: () => {
            timelineStore.renamingTrackId = track.id;
          },
        },
        {
          label: track.locked
            ? t('fastcat.track.unlock', 'Unlock track')
            : t('fastcat.track.lock', 'Lock track'),
          icon: track.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
          onSelect: () => {
            timelineStore.updateTrackProperties(track.id, { locked: !track.locked });
          },
        },
        {
          label: t('fastcat.timeline.deleteTrack'),
          icon: 'i-heroicons-trash',
          onSelect: () => options.onRequestDelete?.(track),
        },
      ],
      [
        {
          label: t('fastcat.track.moveUp', 'Move track up'),
          icon: 'i-heroicons-arrow-up',
          disabled: tracks.filter((t) => t.kind === track.kind)[0]?.id === track.id,
          onSelect: () => timelineStore.moveTrackUp(track.id),
        },
        {
          label: t('fastcat.track.moveDown', 'Move track down'),
          icon: 'i-heroicons-arrow-down',
          disabled: tracks.filter((t) => t.kind === track.kind).slice(-1)[0]?.id === track.id,
          onSelect: () => timelineStore.moveTrackDown(track.id),
        },
      ],
    ];
  };

  return {
    getTrackContextMenuItems,
  };
}
