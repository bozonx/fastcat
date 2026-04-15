<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { formatTimecode } from '~/utils/timecode';
import MarkerThumbnail from '~/components/project/MarkerThumbnail.vue';

defineProps<{
  compact?: boolean;
}>();

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();

const fps = computed(() => projectStore.projectSettings.project.fps || 30);

const markers = computed(() => timelineStore.markers);

/**
 * Formats microseconds to HH:MM:SS:FF
 */
function formatMarkerTimecode(us: number): string {
  return formatTimecode(us, fps.value);
}

const sortedMarkers = computed(() => {
  return [...markers.value].sort((a, b) => a.timeUs - b.timeUs);
});

function handleMarkerClick(marker: { id: string; timeUs: number }) {
  timelineStore.setCurrentTimeUs(marker.timeUs);
  selectionStore.selectTimelineMarker(marker.id);
}
</script>

<template>
  <div class="h-full flex flex-col bg-ui-bg-elevated overflow-hidden">
    <div class="flex-1 overflow-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead
          class="sticky top-0 bg-ui-bg-elevated/95 backdrop-blur-sm z-10 border-b border-ui-border-muted uppercase tracking-wider text-ui-text-muted font-semibold"
        >
          <tr>
            <th class="px-4 py-2.5 w-24"></th>
            <th class="px-4 py-2.5 whitespace-nowrap">{{ $t('common.name') }}</th>
            <th class="px-4 py-2.5 whitespace-nowrap">{{ $t('common.start') }}</th>
            <th class="px-4 py-2.5 whitespace-nowrap">{{ $t('common.end') }}</th>
            <th class="px-4 py-2.5 whitespace-nowrap">{{ $t('common.color') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ui-border-muted/30">
          <tr
            v-for="marker in sortedMarkers"
            :key="marker.id"
            class="group hover:bg-ui-bg-muted/50 cursor-pointer transition-colors"
            :class="{
              'bg-primary-500/10':
                selectionStore.selectedEntity?.source === 'timeline' &&
                selectionStore.selectedEntity.kind === 'marker' &&
                selectionStore.selectedEntity.markerId === marker.id,
            }"
            @click="handleMarkerClick(marker)"
          >
            <td class="px-4 py-2 w-24 align-middle">
              <MarkerThumbnail :marker-id="marker.id" :time-us="marker.timeUs" />
            </td>
            <td class="px-4 py-3 min-w-[140px] truncate max-w-[200px]" :title="marker.text">
              <div class="flex items-center gap-2 truncate">
                <span class="truncate transition-colors group-hover:text-ui-text">
                  {{ marker.text || $t('fastcat.timeline.marker') }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3 font-mono text-[10px] text-ui-text-muted tabular-nums">
              {{ formatMarkerTimecode(marker.timeUs) }}
            </td>
            <td class="px-4 py-3 font-mono text-[10px] text-ui-text-muted tabular-nums">
              {{ marker.durationUs ? formatMarkerTimecode(marker.timeUs + marker.durationUs) : '—' }}
            </td>
            <td class="px-4 py-3">
              <div
                class="w-2.5 h-2.5 rounded-full border border-white/5 shadow-sm"
                :style="{ backgroundColor: marker.color || 'var(--color-primary-500)' }"
              ></div>
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="sortedMarkers.length === 0"
        class="h-full flex flex-col items-center justify-center p-8 text-center text-ui-text-muted opacity-40 select-none"
      >
        <UIcon name="i-heroicons-tag" class="w-8 h-8 mb-3 opacity-20" />
        <span class="text-sm italic">
          {{ $t('videoEditor.fileManager.history.empty') }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
