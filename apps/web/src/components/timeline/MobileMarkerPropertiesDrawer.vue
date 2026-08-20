<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import { useDrawerToolbarOrientation } from '~/composables/timeline/useDrawerToolbarOrientation';
import { TRACK_COLOR_PRESETS } from '~/utils/constants';

interface Props {
  isOpen: boolean;
  markerId: string;
}

const props = defineProps<Props>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { toolbarOrientation } = useDrawerToolbarOrientation();

const timelineStore = useTimelineStore();

const marker = computed(() => {
  return timelineStore.markers.find((m) => m.id === props.markerId) ?? null;
});

const COLORS = computed(() => {
  const commonColors = TRACK_COLOR_PRESETS.slice(1).map((c) => (c === '#f8e71c' ? '#eab308' : c));
  return ['#ffffff', ...commonColors];
});

const activeColor = computed(() => marker.value?.color ?? '#eab308');

function handleUpdateColor(val: string | string[]) {
  if (!marker.value) return;
  timelineStore.updateMarker(marker.value.id, {
    color: Array.isArray(val) ? (val[0] ?? activeColor.value) : val,
  });
}

function confirmDelete() {
  if (!marker.value) return;
  timelineStore.removeMarker(marker.value.id);
  emit('close');
}
</script>

<template>
  <MobilePropertiesDrawer
    v-model:active-snap-point="activeSnapPoint"
    :is-open="props.isOpen"
    @close="emit('close')"
  >
    <template #toolbar>
      <div
        class="flex items-center gap-2 overflow-hidden"
        :class="toolbarOrientation === 'vertical' ? 'flex-col h-full' : 'w-full'"
      >
        <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="confirmDelete" />

        <div
          class="bg-ui-border shrink-0"
          :class="toolbarOrientation === 'vertical' ? 'h-px w-6 my-1' : 'w-px h-6 mx-1'"
        />

        <UiColorPicker
          class="no-scrollbar"
          :class="
            toolbarOrientation === 'vertical'
              ? 'overflow-y-auto px-0.5 min-h-0'
              : 'overflow-x-auto py-0.5 min-w-0'
          "
          :model-value="activeColor"
          mode="marker"
          :colors="COLORS"
          :orientation="toolbarOrientation === 'vertical' ? 'vertical' : 'horizontal'"
          @update:model-value="handleUpdateColor"
        />
      </div>
    </template>

    <div class="px-4 pb-8 pt-4 flex flex-col gap-5">
      <MarkerProperties :marker-id="markerId" is-mobile />
    </div>
  </MobilePropertiesDrawer>
</template>
