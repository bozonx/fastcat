<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
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

const selectionRange = computed(() => timelineStore.getSelectionRange());

function handleDelete() {
  timelineStore.removeSelectionRange();
  selectionStore.clearSelection();
  emit('close');
}

function handleConvertToMarker() {
  timelineStore.convertSelectionRangeToMarker();
  emit('close');
}

function handleRippleTrim() {
  timelineStore.rippleTrimSelectionRange();
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
      <MobileDrawerToolbarButton icon="i-heroicons-trash" @click="handleDelete" />

      <div class="w-px h-6 bg-ui-border mx-1 shrink-0" />

      <MobileDrawerToolbarButton
        icon="i-heroicons-bookmark-square"
        :label="t('fastcat.selectionRange.toZoneMarker')"
        @click="handleConvertToMarker"
      />
      <MobileDrawerToolbarButton
        icon="i-heroicons-scissors"
        :label="t('fastcat.selectionRange.rippleTrim')"
        @click="handleRippleTrim"
      />
    </template>

    <div v-if="selectionRange" class="px-4 pb-8 pt-4">
      <SelectionRangeProperties is-mobile />
    </div>
  </MobilePropertiesDrawer>
</template>
