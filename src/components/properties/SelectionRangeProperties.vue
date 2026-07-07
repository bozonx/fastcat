<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import { formatTimecode } from '~/utils/time';

defineProps<{
  hideActions?: boolean;
  isMobile?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const selectionRange = computed(() => timelineStore.getSelectionRange());

const selectionRangeDurationText = computed(() => {
  const range = selectionRange.value;
  if (!range) return '';
  const fps = timelineStore.timelineFormat?.fps ?? timelineStore.fps;
  return formatTimecode(Math.max(0, range.endUs - range.startUs), fps);
});

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

const commonActions = computed(() => [
  {
    id: 'delete',
    title: t('common.delete'),
    icon: 'i-heroicons-trash',
    onClick: handleDelete,
  },
]);

const mainActions = computed(() => [
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
]);
</script>

<template>
  <div v-if="selectionRange" class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection v-if="!hideActions" :title="t('fastcat.selectionRange.actions')">
      <PropertyActionsBlock :quick-actions="commonActions" :additional-actions="mainActions" />
    </PropertySection>

    <PropertySection :title="t('fastcat.selectionRange.info')">
      <PropertyTimecode
        :label="t('common.start')"
        :model-value="selectionRange.startUs"
        @update:model-value="handleUpdateStartTime"
      />

      <PropertyTimecode
        :label="t('common.end')"
        :model-value="selectionRange.endUs"
        @update:model-value="handleUpdateEndTime"
      />

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.duration') }}</span>
        <span class="text-sm font-mono tabular-nums text-ui-text">
          {{ selectionRangeDurationText }}
        </span>
      </div>
    </PropertySection>
  </div>
</template>
