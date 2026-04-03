<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
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

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

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

const transitionPropertiesRef = ref<any>(null);

const extraActions = computed(() => {
  const hasTransition =
    props.transitionSelection.edge === 'in' ? props.clip.transitionIn : props.clip.transitionOut;
  if (!hasTransition) return [];

  return [
    {
      id: 'save-preset',
      label: t('fastcat.effects.saveAsPreset', 'Save as preset'),
      icon: 'i-heroicons-bookmark',
      onClick: () => {
        transitionPropertiesRef.value?.openSaveModal();
      },
    },
  ];
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <div class="px-4 pb-8">
      <div class="mb-4 pt-1">
        <MobileDrawerToolbar class="-mx-4 mb-2">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete', 'Delete')"
            @click="handleDeleteTransition"
          />
        </MobileDrawerToolbar>

        <div v-if="extraActions.length > 0" class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40">
          <PropertyActionList
            :actions="extraActions"
            vertical
            variant="ghost"
            size="md"
          />
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
  </MobileTimelineDrawer>
</template>
