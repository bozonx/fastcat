<script setup lang="ts">
import { TICKS_PER_SECOND } from '~/utils/time';
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import {
  getPrevClipForItem,
  getNextClipForItem,
  getClipTailTimelineHandleUs,
  getClipHeadTimelineHandleUs,
} from '~/utils/timeline/clip';

const props = defineProps<{
  transitionSelection: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  };
  clip?: TimelineClipItem;
  track?: TimelineTrack;
  hideActions?: boolean;
}>();

const timelineStore = useTimelineStore();

const transitionValue = computed(() => {
  if (!props.clip) return undefined;
  return props.transitionSelection.edge === 'in'
    ? props.clip.transitionIn
    : props.clip.transitionOut;
});

const maxDurationSec = computed(() => {
  if (!props.clip) return 3;
  const clipDurationUs = props.clip.timelineRange?.durationUs ?? 0;
  const oppositeTransitionUs =
    props.transitionSelection.edge === 'in'
      ? (props.clip.transitionOut?.durationUs ?? 0)
      : (props.clip.transitionIn?.durationUs ?? 0);

  let maxUs = clipDurationUs - oppositeTransitionUs;

  const edge = props.transitionSelection.edge;
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  const mode = transition?.mode ?? 'adjacent';

  if (mode === 'adjacent' && props.track) {
    const adjacent =
      edge === 'in'
        ? getPrevClipForItem(props.track, props.clip)
        : getNextClipForItem(props.track, props.clip);

    if (adjacent) {
      const clipEdgeUs =
        edge === 'in'
          ? props.clip.timelineRange.startUs
          : props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs;
      const adjacentEdgeUs =
        edge === 'in'
          ? adjacent.timelineRange.startUs + adjacent.timelineRange.durationUs
          : adjacent.timelineRange.startUs;

      if (Math.abs(clipEdgeUs - adjacentEdgeUs) <= 1_000) {
        const handleUs =
          edge === 'in'
            ? getClipTailTimelineHandleUs(adjacent)
            : getClipHeadTimelineHandleUs(adjacent);

        if (Number.isFinite(handleUs)) {
          maxUs = Math.min(maxUs, handleUs);
        }
      }
    }
  }

  return Math.max(0.1, maxUs / TICKS_PER_SECOND);
});

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionIn: payload.transition,
    });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }

  if (payload.transition === null) {
    const selectionStore = useSelectionStore();
    const current = selectionStore.selectedEntity;
    if (
      current &&
      current.source === 'timeline' &&
      current.kind === 'transition' &&
      current.trackId === payload.trackId &&
      current.itemId === payload.itemId &&
      current.edge === payload.edge
    ) {
      selectionStore.selectTimelineItem(payload.trackId, payload.itemId, 'clip');
    }
  }
}

const panelRef = ref<InstanceType<typeof ClipTransitionPanel> | null>(null);

defineExpose({
  openSaveModal: () => {
    panelRef.value?.openSaveModal();
  },
});
</script>

<template>
  <ClipTransitionPanel
    v-if="clip && transitionSelection.edge"
    ref="panelRef"
    :edge="transitionSelection.edge"
    :track-id="transitionSelection.trackId"
    :item-id="transitionSelection.itemId"
    :track="track"
    :clip="clip"
    :transition="transitionValue"
    :max-duration="maxDurationSec"
    :hide-actions="hideActions"
    @update="handleTransitionUpdate"
  />
</template>
