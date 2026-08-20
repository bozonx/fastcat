import { computed, type Ref } from 'vue';
import type { TimelineTrack } from '~/timeline/types';

interface TimelineStoreActions {
  addTrack: (
    kind: 'video' | 'audio',
    name: string,
    options?: { insertBeforeId?: string; insertAfterId?: string },
  ) => void;
  moveTrackUp: (trackId: string) => void;
  moveTrackDown: (trackId: string) => void;
  timelineDoc: { tracks: TimelineTrack[] } | null;
}

export interface TrackExtraAction {
  id: string;
  label: string;
  icon: string;
  color?: 'primary' | 'danger' | 'warning' | 'success' | 'neutral';
  disabled?: boolean;
  onClick: () => void;
}

interface UseTrackExtraActionsOptions {
  track: Ref<TimelineTrack | null | undefined>;
  timelineStore: TimelineStoreActions;
  onGenerateCaptions?: () => void;
  inDevelopmentFeaturesEnabled?: Ref<boolean>;
}

export function useTrackExtraActions({
  track,
  timelineStore,
  onGenerateCaptions,
  inDevelopmentFeaturesEnabled,
}: UseTrackExtraActionsOptions) {
  const { t } = useI18n();

  const sameKindTracks = computed(() => {
    if (!track.value) return [];
    return (timelineStore.timelineDoc?.tracks ?? []).filter((tr) => tr.kind === track.value!.kind);
  });

  const nextTrackIndex = computed(() => sameKindTracks.value.length + 1);

  function createTrack(options: { insertBeforeId?: string; insertAfterId?: string }) {
    if (!track.value) return;
    const nextName = `${track.value.kind === 'video' ? 'Video' : 'Audio'} ${nextTrackIndex.value}`;
    timelineStore.addTrack(track.value.kind, nextName, options);
  }

  const extraActions = computed<TrackExtraAction[]>(() => {
    if (!track.value) return [];
    const list: TrackExtraAction[] = [];

    if (track.value.kind === 'video' && onGenerateCaptions && inDevelopmentFeaturesEnabled?.value) {
      list.push({
        id: 'generate-captions',
        label: t('fastcat.captions.generate'),
        icon: 'i-heroicons-chat-bubble-bottom-center-text',
        onClick: onGenerateCaptions,
      });
    }

    list.push(
      {
        id: 'create-above',
        label: t(
          `fastcat.timeline.add${track.value.kind === 'video' ? 'Video' : 'Audio'}TrackAbove`,
        ),
        icon:
          track.value.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
        onClick: () => createTrack({ insertBeforeId: track.value!.id }),
      },
      {
        id: 'create-below',
        label: t(
          `fastcat.timeline.add${track.value.kind === 'video' ? 'Video' : 'Audio'}TrackBelow`,
        ),
        icon:
          track.value.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note',
        onClick: () => createTrack({ insertAfterId: track.value!.id }),
      },
    );

    const isFirst = sameKindTracks.value[0]?.id === track.value.id;
    const isLast = sameKindTracks.value.at(-1)?.id === track.value.id;

    if (!isFirst) {
      list.push({
        id: 'move-up',
        label: t('fastcat.track.moveUp'),
        icon: 'i-heroicons-arrow-up',
        onClick: () => timelineStore.moveTrackUp(track.value!.id),
      });
    }

    if (!isLast) {
      list.push({
        id: 'move-down',
        label: t('fastcat.track.moveDown'),
        icon: 'i-heroicons-arrow-down',
        onClick: () => timelineStore.moveTrackDown(track.value!.id),
      });
    }

    return list;
  });

  return { extraActions };
}
