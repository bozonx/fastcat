<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';

interface Props {
  isOpen: boolean;
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

const selectionRange = computed(() => timelineStore.getSelectionRange());

function handleDelete() {
  timelineStore.removeSelectionRange();
  selectionStore.clearSelection();
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
          danger
          @click="handleDelete"
        />
      </MobileDrawerToolbar>
    </template>

    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 rounded bg-slate-800 flex items-center justify-center shrink-0">
          <UIcon name="i-heroicons-rectangle-group" class="w-4 h-4 text-orange-400" />
        </div>
        <span class="text-sm font-bold text-slate-200 truncate leading-none">
          {{ t('fastcat.timeline.selectionRange', 'Selection Range') }}
        </span>
      </div>
    </template>

    <div v-if="selectionRange" class="px-4 pt-4 pb-8">
      <SelectionRangeProperties />
    </div>
  </MobileTimelineDrawer>
</template>
