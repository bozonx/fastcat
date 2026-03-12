<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';

const props = defineProps<{
  transitionSelection: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  };
  clip: any; // TimelineClipItem
  track?: any; // TimelineTrack
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

  return Math.max(0.1, (clipDurationUs - oppositeTransitionUs) / 1_000_000);
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
}
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <ClipTransitionPanel
      v-if="clip"
      :edge="transitionSelection.edge"
      :track-id="transitionSelection.trackId"
      :item-id="transitionSelection.itemId"
      :track="track"
      :clip="clip"
      :transition="transitionValue"
      :max-duration="maxDurationSec"
      @update="handleTransitionUpdate"
    />
  </div>
</template>
