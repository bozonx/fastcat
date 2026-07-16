<script setup lang="ts">
import { TICKS_PER_SECOND } from '~/utils/time';
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import PropertyDuration from '~/components/properties/PropertyDuration.vue';

defineProps<{
  hideActions?: boolean;
  isMobile?: boolean;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const selectionRange = computed(() => timelineStore.getSelectionRange());

const timelineFps = computed(() => timelineStore.timelineFormat?.fps ?? timelineStore.fps);

const selectionRangeDurationTicks = computed(() => {
  const range = selectionRange.value;
  if (!range) return 0;
  return Math.max(0, range.endTicks - range.startTicks);
});

function handleUpdateStartTime(val: number | string) {
  const range = selectionRange.value;
  if (!range) return;

  const startTicks =
    typeof val === 'number' ? val : Math.max(0, Math.round(Number(val) * TICKS_PER_SECOND));
  if (!Number.isFinite(startTicks)) return;

  timelineStore.updateSelectionRange({
    startTicks,
    endTicks: Math.max(startTicks + 1, range.endTicks),
  });
}

function handleUpdateEndTime(val: number | string) {
  const range = selectionRange.value;
  if (!range) return;

  const endTicks =
    typeof val === 'number' ? val : Math.max(0, Math.round(Number(val) * TICKS_PER_SECOND));
  if (!Number.isFinite(endTicks) || endTicks <= range.startTicks) return;

  timelineStore.updateSelectionRange({
    startTicks: range.startTicks,
    endTicks,
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
      <PropertyDuration
        :label="t('common.duration')"
        :model-value="selectionRangeDurationTicks"
        :fps="timelineFps"
      />

      <PropertyTimecode
        :label="t('common.start')"
        :model-value="selectionRange.startTicks"
        :min="0"
        @update:model-value="handleUpdateStartTime"
      />

      <PropertyTimecode
        :label="t('common.end')"
        :model-value="selectionRange.endTicks"
        :min="0"
        @update:model-value="handleUpdateEndTime"
      />
    </PropertySection>
  </div>
</template>
