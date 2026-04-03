<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
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
const workspaceStore = useWorkspaceStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const marker = computed(() => {
  return timelineStore.markers.find((m) => m.id === props.markerId) ?? null;
});

const isDeleteConfirmOpen = ref(false);

function requestDelete() {
  if (!marker.value) return;
  if (workspaceStore.userSettings.deleteWithoutConfirmation) {
    confirmDelete();
  } else {
    isDeleteConfirmOpen.value = true;
  }
}

function confirmDelete() {
  if (!marker.value) return;
  timelineStore.removeMarker(marker.value.id);
  isDeleteConfirmOpen.value = false;
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
    <template #toolbar>
      <MobileDrawerToolbar>
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          @click="requestDelete"
        />
      </MobileDrawerToolbar>

      <div v-if="mainActions.length > 0" class="py-2 px-4 border-b border-ui-border shrink-0">
        <PropertyActionList
          :actions="mainActions"
          vertical
          variant="ghost"
          size="md"
        />
      </div>
    </template>

    <div class="px-4 pt-4 pb-8 flex flex-col gap-5">
      <MarkerProperties :marker-id="markerId" hide-actions />
    </div>

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.marker.deleteTitle', 'Delete marker?')"
      :description="t('fastcat.marker.deleteDescription', 'This action cannot be undone.')"
      color="primary"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />
  </MobileTimelineDrawer>
</template>
