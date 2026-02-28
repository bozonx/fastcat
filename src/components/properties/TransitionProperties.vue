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
}>();

const timelineStore = useTimelineStore();

const transitionValue = computed(() => {
  if (!props.clip) return undefined;
  return props.transitionSelection.edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
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
    <div
      class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1"
    >
      {{ transitionSelection.edge === 'in' ? 'Transition In' : 'Transition Out' }}
    </div>

    <ClipTransitionPanel
      v-if="clip"
      :edge="transitionSelection.edge"
      :track-id="transitionSelection.trackId"
      :item-id="transitionSelection.itemId"
      :transition="transitionValue"
      @update="handleTransitionUpdate"
    />
  </div>
</template>
