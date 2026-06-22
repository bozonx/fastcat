<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, onMounted, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { dispatchMarkerThumbnailGeneration } from '~/timeline/services/marker-thumbnail.service';
const log = createDevLogger('MarkerThumbnail');

const props = defineProps<{
  markerId: string;
  timeUs: number;
}>();

const workspaceStore = useWorkspaceStore();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();

const thumbnailUrl = ref<string | null>(null);
const isLoading = ref(false);

async function loadThumbnail() {
  if (!projectStore.currentProjectId || !workspaceStore.hasPersistentStorage) return;

  isLoading.value = true;
  try {
    // 1. Check OPFS cache first
    const cachedUrl = await fileThumbnailGenerator.getMarkerThumbnail({
      projectId: projectStore.currentProjectId,
      markerId: props.markerId,
      timeUs: props.timeUs,
    });

    if (cachedUrl) {
      thumbnailUrl.value = cachedUrl;
      isLoading.value = false;
      return;
    }

    // 2. Dispatch generation
    if (!timelineStore.timelineDoc) {
      isLoading.value = false;
      return;
    }

    dispatchMarkerThumbnailGeneration({
      projectId: projectStore.currentProjectId,
      markerId: props.markerId,
      timeUs: props.timeUs,
      timelineDoc: timelineStore.timelineDoc,
      onComplete: (url) => {
        thumbnailUrl.value = url;
        isLoading.value = false;
      },
      onError: (err) => {
        log.warn('Failed to load marker thumbnail:', props.markerId, err);
        isLoading.value = false;
      },
    });
  } catch (error) {
    log.error('Failed to load marker thumbnail:', props.markerId, error);
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadThumbnail();
});

// Reload if time changes (marker moved)
watch(
  () => props.timeUs,
  () => {
    void loadThumbnail();
  },
);
</script>

<template>
  <div
    class="relative flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-black/20 ring-1 ring-inset ring-white/5"
  >
    <img
      v-if="thumbnailUrl"
      :src="thumbnailUrl!"
      class="h-full w-full object-cover"
      alt="Marker Preview"
    />
    <div v-else-if="isLoading" class="flex h-full w-full items-center justify-center">
      <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
    <div v-else class="flex h-full w-full items-center justify-center text-[10px] text-white/20">
      No Preview
    </div>
  </div>
</template>
