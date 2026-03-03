<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineMarker } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  markerId: string;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const marker = computed<TimelineMarker | null>(() => {
  return timelineStore.getMarkers().find((m) => m.id === props.markerId) ?? null;
});

const isZone = computed(() => {
  return typeof marker.value?.durationUs === 'number';
});

const activeColor = computed(() => marker.value?.color ?? '#eab308');

const COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#84cc16', label: 'Light Green' },
  { value: '#0ea5e9', label: 'Light Blue' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ffffff', label: 'White' },
  { value: '#000000', label: 'Black' },
];

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

function handleUpdateStartTime(val: number | string) {
  if (!marker.value) return;
  const newStartUs = Math.max(0, Math.round(Number(val) * 1_000_000));
  if (newStartUs === marker.value.timeUs) return;

  const patch: any = { timeUs: newStartUs };
  if (isZone.value && marker.value.durationUs) {
    const endUs = marker.value.timeUs + marker.value.durationUs;
    const newDurationUs = Math.max(0, endUs - newStartUs);
    patch.durationUs = newDurationUs;
  }
  
  timelineStore.updateMarker(marker.value.id, patch);
}

function handleUpdateEndTime(val: number | string) {
  if (!marker.value || !isZone.value) return;
  const newEndUs = Math.max(0, Math.round(Number(val) * 1_000_000));
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
</script>

<template>
  <div v-if="marker" class="w-full flex flex-col gap-2 text-ui-text">
    <PropertySection :title="t('granVideoEditor.marker.actions', 'Actions')">
      <div class="flex gap-2 w-full">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-arrows-right-left"
          class="flex-1 justify-center"
          @click="handleConvertMarker"
        >
          {{
            isZone
              ? t('granVideoEditor.timeline.convertZoneToMarker', 'Convert to normal marker')
              : t('granVideoEditor.timeline.convertMarkerToZone', 'Convert to zone marker')
          }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="red"
          icon="i-heroicons-trash"
          class="flex-1 justify-center"
          @click="handleDeleteMarker"
        >
          {{ t('common.delete', 'Delete') }}
        </UButton>
      </div>
    </PropertySection>

    <PropertySection :title="t('granVideoEditor.marker.info', 'Marker Info')">
      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('granVideoEditor.marker.text', 'Text') }}</span>
        <UTextarea
          :model-value="marker.text"
          size="sm"
          :rows="4"
          @update:model-value="handleUpdateText"
        />
      </div>

      <div class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ isZone ? t('common.start', 'Start Time') : t('common.position', 'Position') }} (s)</span>
        <UInput
          :model-value="marker.timeUs / 1_000_000"
          size="sm"
          type="number"
          step="0.01"
          @update:model-value="handleUpdateStartTime"
        />
      </div>

      <div v-if="isZone" class="flex flex-col gap-0.5 mt-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.end', 'End Time') }} (s)</span>
        <UInput
          :model-value="(marker.timeUs + (marker.durationUs || 0)) / 1_000_000"
          size="sm"
          type="number"
          step="0.01"
          @update:model-value="handleUpdateEndTime"
        />
      </div>

      <div class="flex flex-col gap-1.5 mt-4">
        <span class="text-xs text-ui-text-muted">{{ t('common.color', 'Color') }}</span>
        <div class="grid grid-cols-5 gap-2">
          <button
            v-for="c in COLORS"
            :key="c.value"
            type="button"
            class="w-6 h-6 rounded-full border border-ui-border-muted transition-transform hover:scale-110 flex items-center justify-center"
            :class="{ 'ring-2 ring-primary-500 scale-110': activeColor === c.value }"
            :style="{ backgroundColor: c.value }"
            :title="c.label"
            @click.prevent="handleUpdateColor(c.value)"
          >
          </button>
        </div>
      </div>
    </PropertySection>
  </div>
</template>
