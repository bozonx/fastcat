<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { formatTimecode } from '~/utils/timecode';
import MarkerThumbnail from '~/components/project/MarkerThumbnail.vue';
import MarkerExportModal from '~/components/project/MarkerExportModal.vue';

defineProps<{
  compact?: boolean;
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
  (colors) => {
    selectedColors.value = new Set(colors);
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

function toggleAllColors() {
  if (isAllSelected.value) {
    selectedColors.value = new Set();
  } else {
    selectedColors.value = new Set(availableColors.value);
  }
}

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
}

function isMarkerSelected(markerId: string): boolean {
  return selectionStore.isMarkerSelected(markerId);
}
</script>

<template>
  <div class="h-full flex flex-col bg-ui-bg-elevated overflow-hidden">
    <div class="px-3 py-2 border-b border-ui-border flex items-center gap-2 flex-wrap shrink-0">
      <div class="flex items-center gap-1">
        <button
          v-for="color in availableColors"
          :key="color"
          type="button"
          class="w-4 h-4 rounded-full border border-ui-border transition-all hover:scale-110"
          :class="{
            'ring-2 ring-ui-primary ring-offset-1 ring-offset-ui-bg-elevated':
              selectedColors.has(color),
          }"
          :style="{ backgroundColor: color }"
          @click="toggleColor(color)"
        />
      </div>
      <UButton size="xs" variant="ghost" @click="toggleAllColors">
        {{ $t('fastcat.marker.selectAll') }}
      </UButton>
      <div class="flex-1 min-w-2"></div>
      <UButton
        size="xs"
        variant="soft"
        icon="i-heroicons-document-text"
        :disabled="markers.length === 0"
        @click="openExportModal"
      >
        {{ $t('fastcat.marker.exportAsText') }}
      </UButton>
    </div>

    <div class="flex-1 overflow-auto">
      <table class="w-full text-left text-xs border-collapse table-fixed">
        <thead
          class="sticky top-0 bg-ui-bg-elevated/95 backdrop-blur-sm z-10 border-b border-ui-border-muted uppercase tracking-wider text-ui-text-muted font-semibold"
        >
          <tr>
            <th class="px-3 py-2 w-24"></th>
            <th class="px-3 py-2 w-8"></th>
            <th class="px-3 py-2 whitespace-nowrap">{{ $t('common.text') }}</th>
            <th class="px-3 py-2 w-24 whitespace-nowrap">{{ $t('common.start') }}</th>
            <th class="px-3 py-2 w-24 whitespace-nowrap">{{ $t('common.end') }}</th>
          </tr>
        </thead>
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
            <td class="px-3 py-1.5 w-24 align-middle">
              <MarkerThumbnail :marker-id="marker.id" :time-us="marker.timeUs" />
            </td>
            <td class="px-3 py-2">
              <div
                class="w-2.5 h-2.5 rounded-full border border-white/5 shadow-sm"
                :style="{ backgroundColor: marker.color || 'var(--color-primary-500)' }"
              ></div>
            </td>
            <td class="px-3 py-2 min-w-[140px] truncate" :title="marker.text">
              <div class="flex items-center gap-2 truncate">
                <span class="truncate transition-colors group-hover:text-ui-text">
                  {{ marker.text || $t('fastcat.timeline.marker') }}
                </span>
              </div>
            </td>
            <td class="px-3 py-2 font-mono text-[10px] text-ui-text-muted tabular-nums">
              {{ formatMarkerTimecode(marker.timeUs) }}
            </td>
            <td class="px-3 py-2 font-mono text-[10px] text-ui-text-muted tabular-nums">
              {{
                marker.durationUs ? formatMarkerTimecode(marker.timeUs + marker.durationUs) : '—'
              }}
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
