<script setup lang="ts">
import { useTimelineStore } from '~/stores/timeline.store';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';

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
      <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="confirmDelete" />
    </template>

    <div class="px-4 pb-8 pt-4 flex flex-col gap-5">
      <MarkerProperties :marker-id="markerId" is-mobile />
    </div>
  </MobilePropertiesDrawer>
</template>
