<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

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

function handleConvertToMarker() {
  timelineStore.convertSelectionRangeToMarker();
}

function handleRippleTrim() {
  timelineStore.rippleTrimSelectionRange();
}

const mainActions = computed(() => {
  if (!selectionRange.value) return [];
  return [
    {
      id: 'convert',
      label: t('fastcat.timeline.convertSelectionToZoneMarker'),
      icon: 'i-heroicons-bookmark-square',
      onClick: handleConvertToMarker,
    },
    {
      id: 'ripple-trim',
      label: t('fastcat.timeline.rippleTrimSelection'),
      icon: 'i-heroicons-scissors',
      color: 'warning' as const,
      onClick: handleRippleTrim,
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
    <div v-if="selectionRange" class="px-4 pb-8">
      <div class="mb-4 pt-1">
        <MobileDrawerToolbar class="-mx-4 mb-2">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete')"
            @click="handleDelete"
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

      <SelectionRangeProperties hide-actions />
    </div>
  </MobileTimelineDrawer>
</template>
