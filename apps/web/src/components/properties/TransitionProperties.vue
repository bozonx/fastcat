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
  getClipTailTimelineHandleTicks,
  getClipHeadTimelineHandleTicks,
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
  const clipDurationTicks = props.clip.timelineRange?.durationTicks ?? 0;
  const oppositeTransitionTicks =
    props.transitionSelection.edge === 'in'
      ? (props.clip.transitionOut?.durationTicks ?? 0)
      : (props.clip.transitionIn?.durationTicks ?? 0);

  let maxTicks = clipDurationTicks - oppositeTransitionTicks;

  const edge = props.transitionSelection.edge;
  const transition = edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  const mode = transition?.mode ?? 'adjacent';

  if (mode === 'adjacent' && props.track) {
    const adjacent =
      edge === 'in'
        ? getPrevClipForItem(props.track, props.clip)
        : getNextClipForItem(props.track, props.clip);

    if (adjacent) {
      const clipEdgeTicks =
        edge === 'in'
          ? props.clip.timelineRange.startTicks
          : props.clip.timelineRange.startTicks + props.clip.timelineRange.durationTicks;
      const adjacentEdgeTicks =
        edge === 'in'
          ? adjacent.timelineRange.startTicks + adjacent.timelineRange.durationTicks
          : adjacent.timelineRange.startTicks;

      if (clipEdgeTicks === adjacentEdgeTicks) {
        const handleTicks =
          edge === 'in'
            ? getClipTailTimelineHandleTicks(adjacent)
            : getClipHeadTimelineHandleTicks(adjacent);

        if (Number.isFinite(handleTicks)) {
          maxTicks = Math.min(maxTicks, handleTicks);
        }
      }
    }
  }

  return Math.max(0.1, maxTicks / TICKS_PER_SECOND);
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
