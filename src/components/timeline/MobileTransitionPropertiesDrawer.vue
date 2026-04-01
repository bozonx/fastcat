<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

interface Props {
  isOpen: boolean;
  transitionSelection: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  };
  clip: TimelineClipItem;
  track: TimelineTrack;
}

const props = defineProps<Props>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

function handleDeleteTransition() {
  if (props.transitionSelection.edge === 'in') {
    timelineStore.updateClipTransition(props.transitionSelection.trackId, props.transitionSelection.itemId, {
      transitionIn: null,
    });
  } else {
    timelineStore.updateClipTransition(props.transitionSelection.trackId, props.transitionSelection.itemId, {
      transitionOut: null,
    });
  }
  emit('close');
}
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <template #toolbar>
      <MobileDrawerToolbar>
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          danger
          @click="handleDeleteTransition"
        />
      </MobileDrawerToolbar>
    </template>

    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 rounded bg-slate-800 flex items-center justify-center shrink-0">
          <UIcon name="i-heroicons-arrows-right-left" class="w-4 h-4 text-blue-400" />
        </div>
        <span class="text-sm font-bold text-slate-200 truncate leading-none">
          {{ t('fastcat.timeline.transition.title', 'Transition') }} ({{ transitionSelection.edge === 'in' ? 'In' : 'Out' }})
        </span>
      </div>
    </template>

    <div class="px-4 pt-4 pb-8">
      <TransitionProperties
        v-if="isOpen"
        :transition-selection="transitionSelection"
        :clip="clip"
        :track="track"
      />
    </div>
  </MobileTimelineDrawer>
</template>
