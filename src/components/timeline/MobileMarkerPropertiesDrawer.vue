<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
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

const timelineStore = useTimelineStore();

const marker = computed(() => {
  return timelineStore.markers.find((m) => m.id === props.markerId) ?? null;
});

const COLORS = computed(() => {
  const commonColors = TRACK_COLOR_PRESETS.slice(1);
  return ['#ffffff', ...commonColors];
});

const activeColor = computed(() => marker.value?.color ?? '#eab308');

function handleUpdateColor(val: string) {
  if (!marker.value) return;
  timelineStore.updateMarker(marker.value.id, {
    color: val,
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
      <div class="flex items-center gap-2 w-full overflow-hidden">
        <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="confirmDelete" />

        <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />

        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          <button
            v-for="colorValue in COLORS"
            :key="colorValue"
            type="button"
            class="w-6 h-6 rounded-full border border-ui-border transition-all flex items-center justify-center shrink-0 cursor-pointer"
            :class="{
              'ring-2 ring-primary-500 ring-offset-2 ring-offset-ui-bg-elevated z-10 scale-110':
                activeColor === colorValue,
            }"
            :style="{
              backgroundColor: colorValue,
            }"
            @click.prevent="handleUpdateColor(colorValue)"
          />
        </div>
      </div>
    </template>

    <div class="px-4 pb-8 pt-4 flex flex-col gap-5">
      <MarkerProperties :marker-id="markerId" is-mobile />
    </div>
  </MobilePropertiesDrawer>
</template>
