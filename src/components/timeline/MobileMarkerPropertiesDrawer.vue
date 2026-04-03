<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
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
    </template>

    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 rounded bg-zinc-800 flex items-center justify-center shrink-0">
          <UIcon name="i-heroicons-map-pin" class="w-4 h-4 text-yellow-500" />
        </div>
        <span class="text-sm font-bold text-zinc-200 truncate leading-none">
          {{ marker?.text || t('fastcat.marker.title', 'Marker') }}
        </span>
      </div>
    </template>

    <div v-if="marker" class="px-4 pt-4 pb-8">
      <MarkerProperties :marker-id="markerId" />
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
