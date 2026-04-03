<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const sortedMarkers = computed(() => {
  return [...timelineStore.markers].sort((a, b) => a.timeUs - b.timeUs);
});

function handleJumpToMarker(timeUs: number) {
  timelineStore.setCurrentTimeUs(timeUs);
  emit('close');
}

function handleAddMarker() {
  const marker = timelineStore.addMarkerAtPlayhead();
  if (marker) {
    // Scroll to new marker or just close if desired.
    // Usually on mobile we just close if we jumped.
  }
}
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    :show-close="false"
    :ui="{ body: 'pb-8' }"
    @update:open="!$event && emit('close')"
  >
    <div class="px-4 py-4 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold text-ui-text">
          {{ t('videoEditor.fileManager.history.markers', 'Markers') }}
        </h3>
        <UiActionButton
          icon="lucide:plus"
          size="sm"
          color="primary"
          variant="soft"
          :title="t('fastcat.timeline.addMarker', 'Add marker')"
          @click="handleAddMarker"
        />
      </div>

      <div
        v-if="sortedMarkers.length === 0"
        class="py-20 flex flex-col items-center justify-center gap-4 text-ui-text-muted transition-all duration-300"
      >
        <div class="p-4 rounded-full bg-ui-bg-muted">
          <UIcon name="lucide:map-pin" class="w-8 h-8 opacity-40" />
        </div>
        <span class="text-sm">
          {{ t('videoEditor.fileManager.markers.empty', 'No markers yet') }}
        </span>
      </div>

      <div v-else class="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
        <div
          v-for="marker in sortedMarkers"
          :key="marker.id"
          class="flex items-center gap-3 px-3 py-3 rounded-xl bg-ui-bg border border-ui-border transition-all duration-200 active:scale-[0.98] active:bg-ui-bg-hover cursor-pointer"
          @click="handleJumpToMarker(marker.timeUs)"
        >
          <div
            class="w-3 h-3 rounded-full shrink-0 shadow-sm"
            :style="{ backgroundColor: marker.color || '#eab308' }"
          ></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate text-ui-text">
              {{ marker.text || t('fastcat.marker.marker', 'Marker') }}
            </div>
            <div class="text-[10px] text-ui-text-muted font-mono mt-0.5 opacity-70">
              <UiTimecode :model-value="marker.timeUs" disabled />
            </div>
          </div>
          <UIcon name="lucide:chevron-right" class="size-4 text-ui-text-muted opacity-50" />
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>
