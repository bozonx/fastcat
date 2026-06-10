<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TimelineMarker } from '~/timeline/types';
import { formatTimecode, formatHms } from '~/utils/timecode';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

export interface MarkerExportModalProps {
  markers: TimelineMarker[];
  fps: number;
}

const props = defineProps<MarkerExportModalProps>();
const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();

const DEFAULT_MARKER_COLOR = '#eab308';

const timeFormat = ref<'timecode' | 'hms'>('timecode');
const layoutFormat = ref<'left' | 'right'>('left');
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
      selectedColors.value = new Set(availableColors.value);
      copied.value = false;
      timeFormat.value = 'timecode';
      layoutFormat.value = 'left';
    }
  },
  { immediate: true },
);

function formatTime(us: number): string {
  if (timeFormat.value === 'timecode') {
    return formatTimecode(us, props.fps);
  }
  return formatHms(us);
}

function formatMarkerLine(marker: TimelineMarker): string {
  const timeStr = `[${formatTime(marker.timeUs)}]`;
  const text = marker.text || '';
  if (layoutFormat.value === 'left') {
    return `${timeStr} ${text}`;
  }
  return `${text} ${timeStr}`;
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

function toggleColor(color: string) {
  const next = new Set(selectedColors.value);
  if (next.has(color)) {
    next.delete(color);
  } else {
    next.add(color);
  }
  selectedColors.value = next;
}

const isAllSelected = computed(() => {
  return (
    availableColors.value.length > 0 &&
    availableColors.value.every((c) => selectedColors.value.has(c))
  );
});

function toggleAll() {
  if (isAllSelected.value) {
    selectedColors.value = new Set();
  } else {
    selectedColors.value = new Set(availableColors.value);
  }
}

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

const timeFormatItems = computed(() => [
  { value: 'timecode', label: t('fastcat.marker.timecodeOptions.timecode') },
  { value: 'hms', label: t('fastcat.marker.timecodeOptions.hms') },
]);

const layoutFormatItems = computed(() => [
  { value: 'left', label: t('fastcat.marker.layoutOptions.left') },
  { value: 'right', label: t('fastcat.marker.layoutOptions.right') },
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
        <div class="flex items-center gap-1">
          <button
            v-for="color in availableColors"
            :key="color"
            type="button"
            class="w-5 h-5 rounded-full border border-ui-border transition-all hover:scale-110"
            :class="{
              'ring-2 ring-ui-primary ring-offset-1 ring-offset-ui-bg-elevated':
                selectedColors.has(color),
            }"
            :style="{ backgroundColor: color }"
            @click="toggleColor(color)"
          />
        </div>

        <UButton size="xs" variant="ghost" @click="toggleAll">
          {{ t('fastcat.marker.selectAll') }}
        </UButton>

        <div class="flex-1 min-w-2"></div>

        <UiSelect
          v-model="timeFormat"
          :items="timeFormatItems"
          value-key="value"
          label-key="label"
          size="xs"
          :searchable="false"
          class="min-w-36"
        />

        <UiSelect
          v-model="layoutFormat"
          :items="layoutFormatItems"
          value-key="value"
          label-key="label"
          size="xs"
          :searchable="false"
          class="min-w-36"
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
