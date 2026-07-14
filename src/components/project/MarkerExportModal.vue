<script setup lang="ts">
import { TICKS_PER_SECOND, formatTimecode, formatHms, formatMsOrHms } from '~/utils/time';
import { computed, ref, watch } from 'vue';
import type { TimelineMarker } from '~/timeline/types';
import { DOCUMENTS_DIR_NAME } from '~/utils/constants';
import { resolveNextAvailableFilename } from '~/composables/timeline/export/filenameUtils';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import MarkerColorFilter from '~/components/project/MarkerColorFilter.vue';

type ExportFormat =
  | 'ms-or-hms-left'
  | 'markdown-bracket-left'
  | 'timecode-bracket-left'
  | 'timecode-bracket-right'
  | 'hms-left'
  | 'hms-dash-left'
  | 'hms-right'
  | 'audacity'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'webvtt';

export interface MarkerExportModalProps {
  markers: TimelineMarker[];
  fps: number;
  filterColors?: Set<string>;
}

const props = defineProps<MarkerExportModalProps>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const toast = useToast();
const projectStore = useProjectStore();
const projectTabsStore = useProjectTabsStore();
const fileManagerStore = useFileManagerStore();

const DEFAULT_MARKER_COLOR = '#eab308';

const exportFormat = ref<ExportFormat>('ms-or-hms-left');
const copied = ref(false);
const exported = ref(false);
const isExporting = ref(false);

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  'ms-or-hms-left': 'txt',
  'markdown-bracket-left': 'txt',
  'timecode-bracket-left': 'txt',
  'timecode-bracket-right': 'txt',
  'hms-left': 'txt',
  'hms-dash-left': 'txt',
  'hms-right': 'txt',
  audacity: 'txt',
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  webvtt: 'vtt',
};

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
      exportFormat.value = 'ms-or-hms-left';
    }
  },
  { immediate: true },
);

function formatTimeForExport(us: number): string {
  const isTimecode = exportFormat.value.startsWith('timecode');
  if (isTimecode) {
    return formatTimecode(us, props.fps);
  }
  if (exportFormat.value === 'ms-or-hms-left' || exportFormat.value === 'markdown-bracket-left') {
    return formatMsOrHms(us);
  }
  return formatHms(us);
}

function formatMarkerLine(marker: TimelineMarker): string {
  const timeValue = formatTimeForExport(marker.timeUs);
  const text = marker.text || '';
  switch (exportFormat.value) {
    case 'ms-or-hms-left':
      return `${timeValue} ${text}`;
    case 'markdown-bracket-left':
      return `- [${timeValue}] ${text}`;
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
    default:
      return '';
  }
}

function formatVttTime(us: number): string {
  const totalMs = Math.floor(us / 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
}

const filteredMarkers = computed(() => {
  if (selectedColors.value.size === 0) {
    return [];
  }
  return [...props.markers]
    .filter((marker) => selectedColors.value.has(marker.color || DEFAULT_MARKER_COLOR))
    .sort((a, b) => a.timeUs - b.timeUs);
});

const exportText = computed(() => {
  const markers = filteredMarkers.value;
  if (markers.length === 0) return '';

  if (exportFormat.value === 'json') {
    return JSON.stringify(
      markers.map((m) => ({
        id: m.id,
        timeUs: m.timeUs,
        timecode: formatTimecode(m.timeUs, props.fps),
        text: m.text,
        color: m.color || DEFAULT_MARKER_COLOR,
      })),
      null,
      2,
    );
  }

  if (exportFormat.value === 'audacity') {
    return markers
      .map((m) => {
        const startSec = (m.timeUs / TICKS_PER_SECOND).toFixed(6);
        const endUs = m.durationUs ? m.timeUs + m.durationUs : m.timeUs;
        const endSec = (endUs / TICKS_PER_SECOND).toFixed(6);
        return `${startSec}\t${endSec}\t${m.text || ''}`;
      })
      .join('\n');
  }

  if (exportFormat.value === 'csv' || exportFormat.value === 'tsv') {
    const delimiter = exportFormat.value === 'tsv' ? '\t' : ',';
    const header = ['Name', 'Timecode', 'Description', 'Color'].join(delimiter);
    const rows = markers.map((m) => {
      const name = (m.text || '').replace(/"/g, '""');
      const timecode = formatTimecode(m.timeUs, props.fps);
      const color = m.color || DEFAULT_MARKER_COLOR;
      return `"${name}"${delimiter}"${timecode}"${delimiter}""${delimiter}"${color}"`;
    });
    return [header, ...rows].join('\n');
  }

  if (exportFormat.value === 'webvtt') {
    const lines = ['WEBVTT', ''];
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker) continue;
      const nextMarker = markers[i + 1];
      const startUs = marker.timeUs;
      let endUs = startUs + 5 * TICKS_PER_SECOND;
      if (marker.durationUs && marker.durationUs > 0) {
        endUs = startUs + marker.durationUs;
      } else if (nextMarker) {
        endUs = nextMarker.timeUs;
      }
      lines.push(`${formatVttTime(startUs)} --> ${formatVttTime(endUs)}`);
      lines.push(marker.text || '');
      lines.push('');
    }
    return lines.join('\n');
  }

  return markers.map(formatMarkerLine).join('\n');
});

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

async function handleExportToFile() {
  if (!exportText.value || isExporting.value) {
    return;
  }
  isExporting.value = true;
  try {
    const ext = FORMAT_EXTENSIONS[exportFormat.value] ?? 'txt';
    const existingNames = await projectStore.listEntryNames(DOCUMENTS_DIR_NAME);
    const fileName = resolveNextAvailableFilename(new Set(existingNames), 'markers', ext);
    const filePath = `${DOCUMENTS_DIR_NAME}/${fileName}`;
    await projectStore.writeTextByPath(filePath, exportText.value);
    exported.value = true;
    setTimeout(() => {
      exported.value = false;
    }, 2000);
    toast.add({
      title: t('fastcat.marker.exportFileSuccess', { file: fileName }),
      color: 'success',
    });
    isOpen.value = false;
    projectTabsStore.setActiveTab('files');
    fileManagerStore.openFolderByPath(DOCUMENTS_DIR_NAME);
  } catch {
    toast.add({
      title: t('fastcat.marker.exportFileError'),
      color: 'error',
    });
  } finally {
    isExporting.value = false;
  }
}

const exportFormatItems = computed(() => [
  { value: 'ms-or-hms-left' as ExportFormat, label: t('fastcat.marker.exportFormats.msOrHmsLeft') },
  {
    value: 'markdown-bracket-left' as ExportFormat,
    label: t('fastcat.marker.exportFormats.markdownBracketLeft'),
  },
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
  { value: 'audacity' as ExportFormat, label: t('fastcat.marker.exportFormats.audacity') },
  { value: 'csv' as ExportFormat, label: t('fastcat.marker.exportFormats.csv') },
  { value: 'tsv' as ExportFormat, label: t('fastcat.marker.exportFormats.tsv') },
  { value: 'json' as ExportFormat, label: t('fastcat.marker.exportFormats.json') },
  { value: 'webvtt' as ExportFormat, label: t('fastcat.marker.exportFormats.webvtt') },
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
        <UButton
          size="sm"
          variant="soft"
          color="neutral"
          :icon="exported ? 'i-heroicons-check' : 'i-heroicons-arrow-down-tray'"
          :loading="isExporting"
          @click="handleExportToFile"
        >
          {{ exported ? t('fastcat.marker.exportFileDone') : t('fastcat.marker.exportToFile') }}
        </UButton>
        <UButton size="sm" variant="ghost" @click="void (isOpen = false)">
          {{ t('common.close') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
