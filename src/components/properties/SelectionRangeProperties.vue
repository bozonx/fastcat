<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import TimecodeInput from '~/components/common/TimecodeInput.vue';

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
  if (selectionStore.selectedEntity?.source === 'timeline' && selectionStore.selectedEntity.kind === 'selection-range') {
    selectionStore.clearSelection();
  }
}
</script>

<template>
  <div v-if="selectionRange" class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('granVideoEditor.selectionRange.actions', 'Actions')">
      <div class="grid grid-cols-1 gap-2 w-full">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-bookmark-square"
          class="justify-center"
          @click="handleConvertToMarker"
        >
          {{ t('granVideoEditor.timeline.convertSelectionToZoneMarker', 'Convert to zone marker') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="warning"
          icon="i-heroicons-scissors"
          class="justify-center"
          @click="handleRippleTrim"
        >
          {{ t('granVideoEditor.timeline.rippleTrimSelection', 'Ripple trim selection') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="red"
          icon="i-heroicons-trash"
          class="justify-center"
          @click="handleDelete"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>
    </PropertySection>

    <PropertySection :title="t('granVideoEditor.selectionRange.info', 'Selection Range')">
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.start', 'Start Time') }}</span>
        <TimecodeInput :model-value="selectionRange.startUs" @update:model-value="handleUpdateStartTime" />
      </div>

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }}</span>
        <TimecodeInput :model-value="selectionRange.endUs" @update:model-value="handleUpdateEndTime" />
      </div>
    </PropertySection>
  </div>
</template>
