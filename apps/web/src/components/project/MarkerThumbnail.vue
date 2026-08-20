<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { dispatchMarkerThumbnailGeneration } from '~/timeline/services/marker-thumbnail.service';
const log = createDevLogger('MarkerThumbnail');

const props = defineProps<{
  markerId: string;
  timeTicks: number;
}>();

const workspaceStore = useWorkspaceStore();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();

const thumbnailUrl = ref<string | null>(null);
const isLoading = ref(false);

// This component solely owns the object URL it displays: it mints one from the raw
// blob and revokes it on replacement / unmount. The generator hands back blobs (not
// shared URLs), so two instances rendering the same marker never revoke each other.
function setThumbnailFromBlob(blob: Blob) {
  const nextUrl = URL.createObjectURL(blob);
  if (thumbnailUrl.value) URL.revokeObjectURL(thumbnailUrl.value);
  thumbnailUrl.value = nextUrl;
}

function clearThumbnail() {
  if (thumbnailUrl.value) URL.revokeObjectURL(thumbnailUrl.value);
  thumbnailUrl.value = null;
}

// Monotonic token guarding against stale async results: when the marker moves
// (`timeTicks` changes) a fresh load starts while an earlier generation may still be
// in flight. `addLatestMediaTask` only rejects tasks that haven't started yet, so
// with queue concurrency > 1 an older in-flight render can resolve last and paint a
// stale frame. Each load captures the current token and drops results once it moves.
let loadToken = 0;

async function loadThumbnail() {
  if (!projectStore.currentProjectId || !workspaceStore.hasPersistentStorage) return;

  const token = ++loadToken;
  isLoading.value = true;
  try {
    // 1. Check OPFS cache first
    const cachedBlob = await fileThumbnailGenerator.getMarkerThumbnail({
      projectId: projectStore.currentProjectId,
      markerId: props.markerId,
      timeTicks: props.timeTicks,
    });

    if (token !== loadToken) return;

    if (cachedBlob) {
      setThumbnailFromBlob(cachedBlob);
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
      timeTicks: props.timeTicks,
      timelineDoc: timelineStore.timelineDoc,
      onComplete: (blob) => {
        if (token !== loadToken) return;
        setThumbnailFromBlob(blob);
        isLoading.value = false;
      },
      onError: (err) => {
        if (token !== loadToken) return;
        log.warn('Failed to load marker thumbnail:', props.markerId, err);
        isLoading.value = false;
      },
    });
  } catch (error) {
    if (token !== loadToken) return;
    log.error('Failed to load marker thumbnail:', props.markerId, error);
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadThumbnail();
});

// Reload if time changes (marker moved)
watch(
  () => props.timeTicks,
  () => {
    void loadThumbnail();
  },
);

onUnmounted(() => {
  // Drop this instance's token so any in-flight generation callback is ignored, and
  // release the object URL it owns.
  loadToken++;
  clearThumbnail();
});
</script>

<template>
  <div
    class="relative flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-black ring-1 ring-inset ring-white/5"
  >
    <img
      v-if="thumbnailUrl"
      :src="thumbnailUrl!"
      class="h-full w-full object-contain"
      alt="Marker Preview"
      @error="clearThumbnail()"
    />
    <div v-else-if="isLoading" class="flex h-full w-full items-center justify-center">
      <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
    <div v-else class="flex h-full w-full items-center justify-center text-[10px] text-white/20">
      No Preview
    </div>
  </div>
</template>
