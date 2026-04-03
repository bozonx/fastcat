<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import { formatDurationSeconds } from '~/utils/format';

const props = defineProps<{
  open: boolean;
  entries: FsEntry[];
}>();

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void;
  (e: 'added'): void;
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val),
});

const mediaTypes = computed(() => {
  const types = new Set<string>();
  for (const entry of props.entries) {
    types.add(getMediaTypeFromFilename(entry.name));
  }
  return types;
});

const needsAudioTracks = computed(() => mediaTypes.value.has('audio'));
const needsVideoTracks = computed(() =>
  Array.from(mediaTypes.value).some((type) =>
    ['video', 'image', 'text', 'timeline'].includes(type),
  ),
);

const filteredTracks = computed(() => {
  if (!timelineStore.timelineDoc) return [];
  return timelineStore.timelineDoc.tracks.filter((track) => {
    if (track.kind === 'audio') return needsAudioTracks.value;
    if (track.kind === 'video') return needsVideoTracks.value;
    return false;
  });
});

const selectedTrackId = ref<string | 'new'>('new');

// Initialize selected track when modal opens or tracks change
watch(
  () => props.open,
  (val) => {
    if (val) {
      if (
        timelineStore.selectedTrackId &&
        filteredTracks.value.some((t) => t.id === timelineStore.selectedTrackId)
      ) {
        selectedTrackId.value = timelineStore.selectedTrackId;
      } else {
        selectedTrackId.value = 'new';
      }
    }
  },
  { immediate: true },
);

const currentTimeLabel = computed(() => {
  return formatDurationSeconds(timelineStore.currentTime / 1e6);
});

const isAdding = ref(false);

async function handleAdd() {
  if (isAdding.value) return;
  isAdding.value = true;

  try {
    let targetTrackId = selectedTrackId.value;

    const startUs = timelineStore.currentTime;

    // Handle "new" track creation
    if (targetTrackId === 'new') {
      const kind = needsVideoTracks.value ? 'video' : 'audio';
      const name =
        kind === 'video'
          ? `Video ${filteredTracks.value.filter((t) => t.kind === 'video').length + 1}`
          : `Audio ${filteredTracks.value.filter((t) => t.kind === 'audio').length + 1}`;

      // We need to wait for the track to be added to the doc to get its ID
      // addTrack is synchronous in store but the doc update might be processed next tick or immediate
      timelineStore.addTrack(kind, name);

      // Find the last added track of this kind
      const tracks = timelineStore.timelineDoc?.tracks || [];
      const newTrack = tracks.filter((t) => t.kind === kind).pop();
      if (newTrack) {
        targetTrackId = newTrack.id;
      }
    }

    for (const entry of props.entries) {
      if (!entry.path) continue;
      const mediaType = getMediaTypeFromFilename(entry.name);
      const isAudio = mediaType === 'audio';
      const requiredKind = isAudio ? 'audio' : 'video';

      // Determine track for this specific entry
      let trackIdForThisEntry = targetTrackId;
      const targetTrack = timelineStore.timelineDoc?.tracks.find((t) => t.id === targetTrackId);

      if (!targetTrack || targetTrack.kind !== requiredKind) {
        // Find first compatible track or create one
        const compatible = timelineStore.timelineDoc?.tracks.find((t) => t.kind === requiredKind);
        if (compatible) {
          trackIdForThisEntry = compatible.id;
        } else {
          const name = requiredKind === 'video' ? 'Video' : 'Audio';
          timelineStore.addTrack(requiredKind, name);
          const nt = timelineStore.timelineDoc?.tracks.filter((t) => t.kind === requiredKind).pop();
          if (nt) trackIdForThisEntry = nt.id;
        }
      }

      if (mediaType === 'timeline') {
        await timelineStore.addTimelineClipToTimelineFromPath({
          trackId: trackIdForThisEntry,
          name: entry.name,
          path: entry.path,
          startUs,
        });
      } else {
        await timelineStore.addClipToTimelineFromPath({
          trackId: trackIdForThisEntry,
          name: entry.name,
          path: entry.path,
          startUs,
        });
      }
    }

    await timelineStore.requestTimelineSave({ immediate: true });
    emit('added');
    isOpen.value = false;
  } catch (err) {
    console.error('Failed to add to timeline:', err);
  } finally {
    isAdding.value = false;
  }
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpen" :title="t('common.addToTimeline', 'Add to timeline')">
    <div class="px-4 pt-2 pb-8 space-y-6">
      <div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
        <p class="text-xs font-medium text-zinc-500 uppercase tracking-widest">
          {{ t('mobileFiles.insertAfter', 'Insert after playhead') }}
        </p>
        <p class="text-2xl font-mono font-bold text-primary-400 mt-1">
          {{ currentTimeLabel }}
        </p>
        <p class="text-[10px] text-zinc-500 mt-2 leading-relaxed">
          {{
            t(
              'mobileFiles.addToTimelineDisclaimer',
              'Выбранные файлы будут добавлены на таймлайн начиная с этой позиции.',
            )
          }}
        </p>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between px-1">
          <p class="text-xs font-bold text-zinc-400 uppercase tracking-wider">
            {{ t('mobileFiles.chooseTargetTrack', 'Target Track') }}
          </p>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 font-medium">
            {{ entries.length }} {{ t('common.items', 'items') }}
          </span>
        </div>

        <div class="grid gap-2 overflow-y-auto max-h-[40dvh] pr-1">
          <button
            v-for="track in filteredTracks"
            :key="track.id"
            class="group relative flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-200"
            :class="[
              selectedTrackId === track.id
                ? 'border-primary-500 bg-primary-500/10 scale-[1.02] z-10'
                : 'border-zinc-800/50 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60',
            ]"
            @click="selectedTrackId = track.id"
          >
            <div class="flex items-center gap-4">
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                :class="
                  selectedTrackId === track.id
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'bg-zinc-800 text-zinc-500 shadow-sm'
                "
              >
                <Icon
                  :name="track.kind === 'video' ? 'lucide:film' : 'lucide:music'"
                  class="w-5 h-5"
                />
              </div>
              <div>
                <p
                  class="font-bold text-sm"
                  :class="selectedTrackId === track.id ? 'text-white' : 'text-zinc-200'"
                >
                  {{ track.name }}
                </p>
                <p class="text-[10px] font-medium opacity-60 uppercase tracking-tighter">
                  {{
                    track.kind === 'video'
                      ? t('common.video', 'Video Track')
                      : t('common.audio', 'Audio Track')
                  }}
                </p>
              </div>
            </div>
            <div
              class="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200"
              :class="
                selectedTrackId === track.id
                  ? 'bg-primary-500 scale-100'
                  : 'bg-zinc-800 scale-75 opacity-0'
              "
            >
              <Icon name="lucide:check" class="w-4 h-4 text-white" />
            </div>
          </button>

          <button
            class="group relative flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-200"
            :class="[
              selectedTrackId === 'new'
                ? 'border-primary-500 bg-primary-500/10 scale-[1.02] z-10'
                : 'border-zinc-800/50 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60',
            ]"
            @click="selectedTrackId = 'new'"
          >
            <div class="flex items-center gap-4">
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                :class="
                  selectedTrackId === 'new'
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'bg-zinc-800 text-zinc-500 shadow-sm'
                "
              >
                <Icon name="lucide:plus-circle" class="w-5 h-5" />
              </div>
              <div>
                <p
                  class="font-bold text-sm"
                  :class="selectedTrackId === 'new' ? 'text-white' : 'text-zinc-200'"
                >
                  {{ t('mobileFiles.createNewTrack', 'Create New Track') }}
                </p>
                <p class="text-[10px] font-medium opacity-60 uppercase tracking-tighter">
                  {{ t('mobileFiles.newTrackHint', 'Create and add here') }}
                </p>
              </div>
            </div>
            <div
              class="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200"
              :class="
                selectedTrackId === 'new'
                  ? 'bg-primary-500 scale-100'
                  : 'bg-zinc-800 scale-75 opacity-0'
              "
            >
              <Icon name="lucide:check" class="w-4 h-4 text-white" />
            </div>
          </button>
        </div>
      </div>

      <div class="pt-4">
        <UButton
          block
          size="xl"
          color="primary"
          :loading="isAdding"
          icon="lucide:plus"
          class="rounded-2xl h-14 font-bold shadow-lg shadow-primary-500/20 active:scale-[0.98] transition-all"
          @click="handleAdd"
        >
          {{ t('common.add', 'Add to Timeline') }}
        </UButton>
      </div>
    </div>
  </UiMobileDrawer>
</template>

<style scoped>
/* Scrollbar handled by UiMobileDrawer body class or custom if needed */
</style>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(51, 65, 85, 0.5);
  border-radius: 10px;
}
</style>
