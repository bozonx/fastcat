<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

interface Props {
  isOpen: boolean;
  markerId: string;
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

const marker = computed(() => {
  return timelineStore.markers.find((m) => m.id === props.markerId) ?? null;
});

function confirmDelete() {
  if (!marker.value) return;
  timelineStore.removeMarker(marker.value.id);
  emit('close');
}

const isZone = computed(() => {
  return typeof marker.value?.durationUs === 'number';
});

function handleConvertMarker() {
  if (!marker.value) return;
  if (isZone.value) {
    timelineStore.convertZoneToMarker(marker.value.id);
  } else {
    timelineStore.convertMarkerToZone(marker.value.id);
  }
}

function handleConvertToSelectionRange() {
  if (!marker.value || !isZone.value) return;
  timelineStore.convertMarkerToSelectionRange(marker.value.id);
}

function handleCreateSelectionRange() {
  if (!marker.value || !isZone.value) return;
  timelineStore.createSelectionRangeFromMarker(marker.value.id);
}

const mainActions = computed<any[]>(() => {
  const list: any[] = [];
  if (!marker.value) return list;

  list.push({
    id: 'convert',
    label: isZone.value
      ? t('fastcat.timeline.convertZoneToMarker')
      : t('fastcat.timeline.convertMarkerToZone'),
    icon: 'i-heroicons-arrows-right-left',
    onClick: handleConvertMarker,
  });

  if (isZone.value) {
    list.push(
      {
        id: 'convert-to-selection',
        label: t('fastcat.timeline.convertZoneToSelection'),
        icon: 'i-heroicons-rectangle-group',
        onClick: handleConvertToSelectionRange,
      },
      {
        id: 'create-selection',
        label: t('fastcat.timeline.createSelectionFromZone'),
        icon: 'i-heroicons-sparkles',
        color: 'secondary' as const,
        onClick: handleCreateSelectionRange,
      },
    );
  }
  return list;
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    with-toolbar-snap
  >
    <template #toolbar>
      <MobileDrawerToolbar class="border-b border-ui-border">
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete')"
          @click="confirmDelete"
        />
      </MobileDrawerToolbar>
    </template>

    <div class="px-4 pb-8 pt-4 flex flex-col gap-5">
      <div>
        <div
          v-if="mainActions.length > 0"
          class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40"
        >
          <PropertyActionList :actions="mainActions" vertical variant="ghost" size="md" />
        </div>
      </div>

      <MarkerProperties :marker-id="markerId" hide-actions />
    </div>
  </MobileTimelineDrawer>
</template>
