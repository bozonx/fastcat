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

function isLightColor(hex: string): boolean {
  const sanitized = hex.replace('#', '');
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

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
      <div
        class="flex items-center gap-2 overflow-hidden"
        :class="toolbarOrientation === 'vertical' ? 'flex-col h-full' : 'w-full'"
      >
        <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="confirmDelete" />

        <div
          class="bg-ui-border shrink-0"
          :class="toolbarOrientation === 'vertical' ? 'h-px w-6 my-1' : 'w-px h-6 mx-1'"
        />

        <div
          class="flex items-center gap-1.5 no-scrollbar"
          :class="
            toolbarOrientation === 'vertical'
              ? 'flex-col overflow-y-auto px-0.5 min-h-0'
              : 'overflow-x-auto py-0.5 min-w-0'
          "
        >
          <button
            v-for="colorValue in COLORS"
            :key="colorValue"
            type="button"
            class="w-6 h-6 rounded-full border border-ui-border transition-all flex items-center justify-center shrink-0 cursor-pointer relative focus:outline-none focus-visible:outline-none outline-none"
            :class="{
              'ring-2 ring-ui-primary ring-offset-2 ring-offset-ui-bg-elevated z-10 scale-110':
                activeColor === colorValue,
            }"
            :style="{
              backgroundColor: colorValue,
            }"
            @click.prevent="handleUpdateColor(colorValue)"
          >
            <span
              v-if="activeColor === colorValue"
              class="absolute inset-0 flex items-center justify-center text-xs font-bold leading-none select-none"
              :class="isLightColor(colorValue) ? 'text-black' : 'text-white'"
            >
              ✓
            </span>
          </button>
        </div>
      </div>
    </template>

    <div class="px-4 pb-8 pt-4 flex flex-col gap-5">
      <MarkerProperties :marker-id="markerId" is-mobile />
    </div>
  </MobilePropertiesDrawer>
</template>
