<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { formatTimecode } from '~/utils/timecode';
import MarkerThumbnail from '~/components/project/MarkerThumbnail.vue';
import MarkerExportModal from '~/components/project/MarkerExportModal.vue';
import MarkerColorFilter from '~/components/project/MarkerColorFilter.vue';

defineProps<{
  compact?: boolean;
}>();

const emit = defineEmits<{
  (e: 'marker-click', marker: import('~/timeline/types').TimelineMarker): void;
}>();

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const fps = computed(() => timelineStore.timelineFormat.fps || 30);

const markers = computed(() => timelineStore.markers);

const DEFAULT_MARKER_COLOR = '#eab308';

function formatMarkerTimecode(us: number): string {
  return formatTimecode(us, fps.value);
}

const sortedMarkers = computed(() => {
  return [...markers.value].sort((a, b) => a.timeUs - b.timeUs);
});

const availableColors = computed(() => {
  const colors = new Set<string>();
  for (const marker of markers.value) {
    colors.add(marker.color || DEFAULT_MARKER_COLOR);
  }
  return Array.from(colors);
});

const selectedColors = ref<Set<string>>(new Set());

watch(
  availableColors,
  (newColors, oldColors) => {
    if (!oldColors || oldColors.length === 0) {
      selectedColors.value = new Set(newColors);
      return;
    }
    const next = new Set(selectedColors.value);
    for (const color of newColors) {
      if (!oldColors.includes(color)) {
        next.add(color);
      }
    }
    for (const color of next) {
      if (!newColors.includes(color)) {
        next.delete(color);
      }
    }
    selectedColors.value = next;
  },
  { immediate: true },
);

const filteredSortedMarkers = computed(() => {
  if (selectedColors.value.size === 0) {
    return [];
  }
  return sortedMarkers.value.filter((marker) =>
    selectedColors.value.has(marker.color || DEFAULT_MARKER_COLOR),
  );
});

const isExportModalOpen = ref(false);

function openExportModal() {
  isExportModalOpen.value = true;
}

function handleMarkerClick(marker: { id: string; timeUs: number }, event: MouseEvent) {
  timelineStore.setCurrentTimeUs(marker.timeUs);

  if (event.shiftKey) {
    const currentIds =
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'markers'
        ? selectionStore.selectedEntity.markerIds
        : selectionStore.selectedEntity?.source === 'timeline' &&
            selectionStore.selectedEntity.kind === 'marker'
          ? [selectionStore.selectedEntity.markerId]
          : [];

    if (currentIds.includes(marker.id)) {
      selectionStore.selectTimelineMarkers(currentIds.filter((id) => id !== marker.id));
    } else {
      selectionStore.selectTimelineMarkers([...currentIds, marker.id]);
    }
    return;
  }

  selectionStore.selectTimelineMarker(marker.id);
  emit('marker-click', marker as import('~/timeline/types').TimelineMarker);
}

function isMarkerSelected(markerId: string): boolean {
  return selectionStore.isMarkerSelected(markerId);
}
</script>

<template>
  <div class="h-full flex flex-col bg-ui-bg-elevated overflow-hidden select-none">
    <div class="flex items-center gap-2 px-3 h-9 border-b border-ui-border bg-ui-bg/30 shrink-0">
      <MarkerColorFilter
        :available-colors="availableColors"
        v-model="selectedColors"
      />
      <div class="flex-1"></div>
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-heroicons-document-text"
        :disabled="markers.length === 0"
        class="cursor-pointer"
        @click="openExportModal"
      >
        {{ $t('fastcat.marker.exportAsText') }}
      </UButton>
    </div>

    <div class="flex-1 overflow-auto custom-scrollbar">
      <table class="w-full text-left text-xs border-collapse table-fixed">
        <tbody class="divide-y divide-ui-border/50">
          <tr
            v-for="marker in filteredSortedMarkers"
            :key="marker.id"
            class="group hover:bg-ui-bg-muted/50 cursor-pointer transition-colors"
            :class="{
              'bg-primary-500/10': isMarkerSelected(marker.id),
            }"
            @click="handleMarkerClick(marker, $event)"
          >
            <td class="px-3 py-2 w-24 align-middle">
              <MarkerThumbnail :marker-id="marker.id" :time-us="marker.timeUs" />
            </td>
            <td class="px-3 py-2 w-6 align-middle">
              <div
                class="w-2.5 h-2.5 rounded-full border border-white/5 shadow-sm"
                :style="{ backgroundColor: marker.color || 'var(--color-primary-500)' }"
              ></div>
            </td>
            <td class="px-3 py-2 text-left align-middle truncate" :title="marker.text">
              <div class="flex items-center gap-2 truncate">
                <span class="truncate transition-colors group-hover:text-ui-text">
                  {{ marker.text || $t('fastcat.timeline.marker') }}
                </span>
              </div>
            </td>
            <td class="px-3 py-2 w-28 align-middle font-mono text-[10px] text-ui-text-muted tabular-nums">
              <div class="flex flex-col justify-center">
                <span>{{ formatMarkerTimecode(marker.timeUs) }}</span>
                <span v-if="marker.durationUs" class="text-[9px] opacity-60 mt-0.5 whitespace-nowrap">
                  ↳ {{ formatMarkerTimecode(marker.timeUs + marker.durationUs) }}
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <UiEmptyState
        v-if="filteredSortedMarkers.length === 0"
        :message="$t('videoEditor.fileManager.markers.empty')"
        icon="i-heroicons-tag"
        icon-class="w-8 h-8 mx-auto mb-3 opacity-20"
        wrapper-class="h-full flex flex-col items-center justify-center p-8 opacity-40 select-none"
      />
    </div>

    <MarkerExportModal v-model:open="isExportModalOpen" :markers="markers" :fps="fps" />
  </div>
</template>

<style scoped>
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
