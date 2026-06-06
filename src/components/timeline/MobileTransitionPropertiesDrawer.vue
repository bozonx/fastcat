<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
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

function handleDeleteTransition() {
  if (props.transitionSelection.edge === 'in') {
    timelineStore.updateClipTransition(
      props.transitionSelection.trackId,
      props.transitionSelection.itemId,
      {
        transitionIn: null,
      },
    );
  } else {
    timelineStore.updateClipTransition(
      props.transitionSelection.trackId,
      props.transitionSelection.itemId,
      {
        transitionOut: null,
      },
    );
  }
  emit('close');
}

const transitionPropertiesRef = ref<InstanceType<
  typeof import('~/components/properties/TransitionProperties.vue').default
> | null>(null);

const extraActions = computed(() => {
  const hasTransition =
    props.transitionSelection.edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  if (!hasTransition) return [];

  return [
    {
      id: 'save-preset',
      label: t('fastcat.effects.saveAsPreset'),
      icon: 'i-heroicons-bookmark',
      onClick: () => {
        transitionPropertiesRef.value?.openSaveModal();
      },
    },
  ];
});
</script>

<template>
  <MobilePropertiesDrawer
    v-model:active-snap-point="activeSnapPoint"
    :is-open="props.isOpen"
    @close="emit('close')"
  >
    <template #toolbar>
      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        :label="t('common.delete')"
        @click="handleDeleteTransition"
      />
    </template>

    <div class="px-4 pb-8 pt-4">
      <div class="mb-4">
        <div
          v-if="extraActions.length > 0"
          class="py-1 px-3 border border-ui-border rounded-xl bg-ui-bg-elevated/40"
        >
          <PropertyActionList :actions="extraActions" vertical variant="ghost" size="md" />
        </div>
      </div>

      <TransitionProperties
        v-if="isOpen"
        ref="transitionPropertiesRef"
        :transition-selection="transitionSelection"
        :clip="clip"
        :track="track"
        hide-actions
      />
    </div>
  </MobilePropertiesDrawer>
</template>
