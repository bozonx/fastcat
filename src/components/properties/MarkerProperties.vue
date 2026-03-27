<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineMarker } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

const props = defineProps<{
  markerId: string;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const marker = computed<TimelineMarker | null>(() => {
  return timelineStore.markers.find((m) => m.id === props.markerId) ?? null;
});

const isZone = computed(() => {
  return typeof marker.value?.durationUs === 'number';
});

function handleUpdateText(val: string | undefined) {
  if (!marker.value) return;
  timelineStore.updateMarker(marker.value.id, {
    text: typeof val === 'string' ? val : '',
  });
}

function handleUpdateColor(val: string) {
  if (!marker.value) return;
  timelineStore.updateMarker(marker.value.id, {
    color: val,
  });
}

function handleUpdateStartTime(val: number) {
  if (!marker.value) return;
  const newStartUs = val;

  if (isNaN(newStartUs) || newStartUs < 0) return;
  if (newStartUs === marker.value.timeUs) return;

  const patch: { timeUs: number; durationUs?: number } = { timeUs: newStartUs };
  if (isZone.value && marker.value.durationUs) {
    const endUs = marker.value.timeUs + marker.value.durationUs;
    const newDurationUs = Math.max(0, endUs - newStartUs);
    patch.durationUs = newDurationUs;
  }

  timelineStore.updateMarker(marker.value.id, patch);
}

function handleUpdateEndTime(val: number) {
  if (!marker.value || !isZone.value) return;
  const newEndUs = val;

  if (isNaN(newEndUs) || newEndUs < 0) return;
  const currentStartUs = marker.value.timeUs;

  if (newEndUs <= currentStartUs) return;

  const newDurationUs = newEndUs - currentStartUs;
  if (newDurationUs === marker.value.durationUs) return;

  timelineStore.updateMarker(marker.value.id, {
    durationUs: newDurationUs,
  });
}

function handleDeleteMarker() {
  if (!marker.value) return;
  timelineStore.removeMarker(marker.value.id);
}

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

const commonActions = computed(() => [
  {
    id: 'delete',
    title: t('common.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    onClick: handleDeleteMarker,
  },
]);

const mainActions = computed<any[]>(() => {
  const list: any[] = [
    {
      id: 'convert',
      label: isZone.value
        ? t('fastcat.timeline.convertZoneToMarker', 'Convert to normal marker')
        : t('fastcat.timeline.convertMarkerToZone', 'Convert to zone marker'),
      icon: 'i-heroicons-arrows-right-left',
      onClick: handleConvertMarker,
    },
  ];

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
  <div v-if="marker" class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('fastcat.marker.actions', 'Actions')">
      <div class="flex flex-col w-full">
        <PropertyActionList
          :actions="commonActions"
          :vertical="false"
          justify="start"
          variant="ghost"
          size="xs"
          class="mb-2"
        />

        <PropertyActionList :actions="mainActions" justify="start" size="xs" />
      </div>
    </PropertySection>

    <PropertySection :title="t('fastcat.marker.info', 'Marker Info')">
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.marker.text', 'Text') }}</span>
        <UTextarea
          :model-value="marker.text"
          size="sm"
          :rows="4"
          @update:model-value="handleUpdateText"
        />
      </div>

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{
          isZone ? t('common.start', 'Start Time') : t('common.position', 'Position')
        }}</span>
        <UiTimecode :model-value="marker.timeUs" @update:model-value="handleUpdateStartTime" />
      </div>

      <div v-if="isZone" class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }}</span>
        <UiTimecode
          :model-value="marker.timeUs + (marker.durationUs || 0)"
          @update:model-value="handleUpdateEndTime"
        />
      </div>

      <div class="flex flex-col gap-2 mt-4 pb-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.color', 'Color') }}</span>
        <UiColorPicker
          :model-value="marker.color ?? '#eab308'"
          mode="marker"
          @update:model-value="handleUpdateColor"
        />
      </div>
    </PropertySection>
  </div>
</template>
