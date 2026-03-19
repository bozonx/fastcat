<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const selectionRange = computed(() => timelineStore.getSelectionRange());

function handleUpdateStartTime(val: number | string) {
  const range = selectionRange.value;
  if (!range) return;

  const startUs = typeof val === 'number' ? val : Math.max(0, Math.round(Number(val) * 1_000_000));
  if (!Number.isFinite(startUs)) return;

  timelineStore.updateSelectionRange({
    startUs,
    endUs: Math.max(startUs + 1, range.endUs),
  });
}

function handleUpdateEndTime(val: number | string) {
  const range = selectionRange.value;
  if (!range) return;

  const endUs = typeof val === 'number' ? val : Math.max(0, Math.round(Number(val) * 1_000_000));
  if (!Number.isFinite(endUs) || endUs <= range.startUs) return;

  timelineStore.updateSelectionRange({
    startUs: range.startUs,
    endUs,
  });
}

function handleConvertToMarker() {
  timelineStore.convertSelectionRangeToMarker();
}

function handleRippleTrim() {
  timelineStore.rippleTrimSelectionRange();
}

function handleDelete() {
  timelineStore.removeSelectionRange();
  if (
    selectionStore.selectedEntity?.source === 'timeline' &&
    selectionStore.selectedEntity.kind === 'selection-range'
  ) {
    selectionStore.clearSelection();
  }
}

const actions = computed(() => [
  {
    id: 'convert',
    label: t('fastcat.timeline.convertSelectionToZoneMarker', 'Convert to zone marker'),
    icon: 'i-heroicons-bookmark-square',
    onClick: handleConvertToMarker,
  },
  {
    id: 'ripple-trim',
    label: t('fastcat.timeline.rippleTrimSelection', 'Ripple trim selection'),
    icon: 'i-heroicons-scissors',
    color: 'warning' as const,
    onClick: handleRippleTrim,
  },
  {
    id: 'delete',
    label: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    color: 'danger' as const,
    onClick: handleDelete,
  },
]);
</script>

<template>
  <div v-if="selectionRange" class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('fastcat.selectionRange.actions', 'Actions')">
      <PropertyActionList :actions="actions" justify="center" size="xs" />
    </PropertySection>

    <PropertySection :title="t('fastcat.selectionRange.info', 'Selection Range')">
      <PropertyTimecode
        :label="t('common.start', 'Start Time')"
        :model-value="selectionRange.startUs"
        @update:model-value="handleUpdateStartTime"
      />

      <PropertyTimecode
        :label="t('common.end', 'End Time')"
        :model-value="selectionRange.endUs"
        @update:model-value="handleUpdateEndTime"
      />
    </PropertySection>
  </div>
</template>
