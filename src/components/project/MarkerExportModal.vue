<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TimelineMarker } from '~/timeline/types';
import { formatTimecode, formatHms } from '~/utils/time';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import MarkerColorFilter from '~/components/project/MarkerColorFilter.vue';

type ExportFormat =
  | 'timecode-bracket-left'
  | 'timecode-bracket-right'
  | 'hms-left'
  | 'hms-dash-left'
  | 'hms-right';

export interface MarkerExportModalProps {
  markers: TimelineMarker[];
  fps: number;
  filterColors?: Set<string>;
}

const props = defineProps<MarkerExportModalProps>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const DEFAULT_MARKER_COLOR = '#eab308';

const exportFormat = ref<ExportFormat>('hms-left');
const copied = ref(false);

const availableColors = computed(() => {
  const colors = new Set<string>();
  for (const marker of props.markers) {
    colors.add(marker.color || DEFAULT_MARKER_COLOR);
  }
  return Array.from(colors);
});

const selectedColors = ref<Set<string>>(new Set());

watch(
  isOpen,
  (open) => {
    if (open) {
      selectedColors.value = props.filterColors
        ? new Set(props.filterColors)
        : new Set(availableColors.value);
      copied.value = false;
      exportFormat.value = 'hms-left';
    }
  },
  { immediate: true },
);

function formatTimeForExport(us: number): string {
  const isTimecode = exportFormat.value.startsWith('timecode');
  if (isTimecode) {
    return formatTimecode(us, props.fps);
  }
  return formatHms(us);
}

function formatMarkerLine(marker: TimelineMarker): string {
  const timeValue = formatTimeForExport(marker.timeUs);
  const text = marker.text || '';
  switch (exportFormat.value) {
    case 'timecode-bracket-left':
      return `[${timeValue}] ${text}`;
    case 'timecode-bracket-right':
      return `${text} [${timeValue}]`;
    case 'hms-left':
      return `${timeValue} ${text}`;
    case 'hms-dash-left':
      return `${timeValue} - ${text}`;
    case 'hms-right':
      return `${text} ${timeValue}`;
  }
}

const filteredMarkers = computed(() => {
  if (selectedColors.value.size === 0) {
    return [];
  }
  return [...props.markers]
    .filter((marker) => selectedColors.value.has(marker.color || DEFAULT_MARKER_COLOR))
    .sort((a, b) => a.timeUs - b.timeUs);
});

const exportText = computed(() => filteredMarkers.value.map(formatMarkerLine).join('\n'));

async function handleCopy() {
  if (!exportText.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(exportText.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // Ignore copy errors
  }
}

const exportFormatItems = computed(() => [
  { value: 'hms-left' as ExportFormat, label: t('fastcat.marker.exportFormats.hmsLeft') },
  { value: 'hms-dash-left' as ExportFormat, label: t('fastcat.marker.exportFormats.hmsDashLeft') },
  { value: 'hms-right' as ExportFormat, label: t('fastcat.marker.exportFormats.hmsRight') },
  {
    value: 'timecode-bracket-left' as ExportFormat,
    label: t('fastcat.marker.exportFormats.timecodeBracketLeft'),
  },
  {
    value: 'timecode-bracket-right' as ExportFormat,
    label: t('fastcat.marker.exportFormats.timecodeBracketRight'),
  },
]);
</script>

<template>
  <UiModal v-model:open="isOpen" :close-button="true">
    <template #header>
      <div class="text-base font-semibold text-ui-text truncate">
        {{ t('fastcat.marker.exportTitle') }}
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <MarkerColorFilter v-model="selectedColors" :available-colors="availableColors" />

        <div class="flex-1 min-w-2"></div>

        <UiSelect
          v-model="exportFormat"
          :items="exportFormatItems"
          value-key="value"
          label-key="label"
          size="xs"
          :searchable="false"
          class="min-w-52"
        />
      </div>

      <textarea
        readonly
        class="w-full h-64 p-3 text-xs font-mono bg-ui-bg border border-ui-border rounded-md resize-none custom-scrollbar text-ui-text"
        :value="exportText"
      />
    </div>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          size="sm"
          variant="soft"
          :color="copied ? 'success' : 'primary'"
          :icon="copied ? 'i-heroicons-check' : 'i-heroicons-clipboard-document'"
          @click="handleCopy"
        >
          {{ copied ? t('common.copiedToClipboard') : t('common.copy') }}
        </UButton>
        <UButton size="sm" variant="ghost" @click="isOpen = false">
          {{ t('common.close') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
