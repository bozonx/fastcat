<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { TimelineCommand } from '~/timeline/commands';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import UiColorPicker from '~/components/ui/UiColorPicker.vue';

const props = defineProps<{
  markerIds: string[];
  isMobile?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const selectedMarkers = computed(() =>
  timelineStore.markers.filter((m) => props.markerIds.includes(m.id)),
);

const selectedCountLabel = computed(() =>
  t('fastcat.timeline.selectedMarkersCount', { count: selectedMarkers.value.length }),
);

// Show the shared color when every selected marker uses it, otherwise fall back
// to the default so the picker has a sensible starting value.
const commonColor = computed(() => {
  const colors = new Set(selectedMarkers.value.map((m) => m.color ?? '#eab308'));
  return colors.size === 1 ? [...colors][0]! : '#eab308';
});

function handleDeleteAll() {
  const cmds: TimelineCommand[] = selectedMarkers.value.map((m) => ({
    type: 'remove_marker',
    id: m.id,
  }));
  if (cmds.length === 0) return;

  timelineStore.batchApplyTimeline(cmds);
  selectionStore.clearSelection();
}

function handleUpdateColorAll(val: string | string[]) {
  const color = Array.isArray(val) ? (val[0] ?? '#eab308') : val;
  const cmds: TimelineCommand[] = selectedMarkers.value.map((m) => ({
    type: 'update_marker',
    id: m.id,
    color,
  }));
  if (cmds.length === 0) return;

  timelineStore.batchApplyTimeline(cmds);
}

const commonActions = computed(() => [
  {
    id: 'delete',
    title: t('common.delete'),
    icon: 'i-heroicons-trash',
    onClick: handleDeleteAll,
  },
]);
</script>

<template>
  <div class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="selectedCountLabel">
      <PropertyActionsBlock :quick-actions="isMobile ? [] : commonActions" />
    </PropertySection>

    <PropertySection v-if="!isMobile" :title="t('common.color')">
      <div class="flex flex-col gap-2 mt-2 pb-2">
        <UiColorPicker
          :model-value="commonColor"
          mode="marker"
          @update:model-value="handleUpdateColorAll"
        />
      </div>
    </PropertySection>
  </div>
</template>
