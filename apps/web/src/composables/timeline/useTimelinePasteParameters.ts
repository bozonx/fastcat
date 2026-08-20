import { computed, ref, watch } from 'vue';
import type { TimelineClipItem, TimelineTrack, TrackKind } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';
import { resolveClipParametersApplyTargets } from '~/utils/timeline/clip-parameters';

const PASTE_PARAMETERS_HISTORY_LABEL_KEY =
  'videoEditor.fileManager.history.entries.updateClipProperties';

/**
 * Wires the "paste clip parameters" trigger to the paste modal, extracted from
 * `TimelineTracks.vue`. Only opens when the targeted clip belongs to the
 * currently rendered tracks.
 */
export function useTimelinePasteParameters(tracks: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();

  const activeClipForPasteParameters = ref<TimelineClipItem | null>(null);
  const activeTrackKindForPasteParameters = ref<TrackKind>('video');

  const {
    isPasteParametersModalOpen,
    selectedParameterGroups,
    clipParameterGroupOptions,
    openPasteClipParameters,
    applyClipParameters,
  } = useClipParametersClipboard({
    clip: computed(() => activeClipForPasteParameters.value || ({} as TimelineClipItem)),
    trackKind: computed(() => activeTrackKindForPasteParameters.value),
    resolveApplyTargets: (target) =>
      resolveClipParametersApplyTargets({
        doc: timelineStore.timelineDoc,
        selectedItemIds: timelineStore.selectedItemIds,
        target,
      }),
    applyCommands: (cmds) =>
      timelineStore.batchApplyTimeline(cmds, {
        historyMode: 'immediate',
        labelKey: PASTE_PARAMETERS_HISTORY_LABEL_KEY,
      }),
  });

  watch(
    () => uiStore.clipPasteParametersTrigger,
    (val) => {
      if (!val) return;
      const track = tracks().find((t) => t.id === val.trackId);
      if (!track) return;
      const clip = track.items.find(
        (it) => it.id === val.itemId && it.kind === 'clip',
      ) as TimelineClipItem;
      if (clip) {
        activeClipForPasteParameters.value = clip;
        activeTrackKindForPasteParameters.value = track.kind;
        // Opening is deferred to a macrotask inside the composable so it survives
        // being invoked from a closing context menu / dropdown layer.
        openPasteClipParameters(clip, track.kind);
      }
    },
  );

  return {
    isPasteParametersModalOpen,
    selectedParameterGroups,
    clipParameterGroupOptions,
    applyClipParameters,
  };
}
