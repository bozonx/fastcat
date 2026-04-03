<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
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
const selectionStore = useSelectionStore();

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
      ? t('fastcat.timeline.convertZoneToMarker', 'Convert to normal marker')
      : t('fastcat.timeline.convertMarkerToZone', 'Convert to zone marker'),
    icon: 'i-heroicons-arrows-right-left',
    onClick: handleConvertMarker,
  });

  if (isZone.value) {
    list.push(
      {
        id: 'convert-to-selection',
        label: t('fastcat.timeline.convertZoneToSelection', 'Convert to selection area'),
        icon: 'i-heroicons-rectangle-group',
        onClick: handleConvertToSelectionRange,
      },
      {
        id: 'create-selection',
        label: t('fastcat.timeline.createSelectionFromZone', 'Create selection area'),
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
    force-landscape-direction="bottom"
  >
    <div class="px-4 pb-8 flex flex-col gap-5">
      <div class="pt-1">
        <MobileDrawerToolbar class="-mx-4 mb-2">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete', 'Delete')"
            @click="confirmDelete"
          />
        </MobileDrawerToolbar>

        <div v-if="mainActions.length > 0" class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40">
          <PropertyActionList
            :actions="mainActions"
            vertical
            variant="ghost"
            size="md"
          />
        </div>
      </div>

      <MarkerProperties :marker-id="markerId" hide-actions />
    </div>
  </MobileTimelineDrawer>
</template>
