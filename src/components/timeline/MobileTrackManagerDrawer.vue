<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable, type DraggableEvent } from 'vue-draggable-plus';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import { useCloseModel } from '~/composables/ui/useCloseModel';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const isOpenLocal = useCloseModel(
  () => props.isOpen,
  () => emit('close'),
);

const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

const localTracks = computed({
  get: () => tracks.value,
  set: (newTracks) => {
    timelineStore.reorderTracks(newTracks.map((t) => t.id));
    timelineStore.requestTimelineSave({ immediate: true });
  },
});

// Rename State
const isRenameOpen = ref(false);
const trackToRename = ref<TimelineTrack | null>(null);

function openRename(track: TimelineTrack) {
  trackToRename.value = track;
  isRenameOpen.value = true;
}

function handleRename(name: string) {
  if (trackToRename.value) {
    const trimmed = name.trim();
    if (trimmed) {
      timelineStore.renameTrack(trackToRename.value.id, trimmed);
    }
  }
  isRenameOpen.value = false;
  trackToRename.value = null;
}

// Delete State
const isDeleteConfirmOpen = ref(false);
const trackToDelete = ref<TimelineTrack | null>(null);

function requestDeleteTrack(track: TimelineTrack) {
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (track.items.length === 0 || skipConfirm) {
    timelineStore.deleteTrack(track.id, { allowNonEmpty: true });
  } else {
    trackToDelete.value = track;
    isDeleteConfirmOpen.value = true;
  }
}

function confirmDeleteTrack() {
  if (trackToDelete.value) {
    timelineStore.deleteTrack(trackToDelete.value.id, { allowNonEmpty: true });
    isDeleteConfirmOpen.value = false;
    trackToDelete.value = null;
  }
}

// Quick Actions
function toggleMute(trackId: string) {
  timelineStore.toggleTrackAudioMuted(trackId);
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleSolo(trackId: string) {
  timelineStore.toggleTrackAudioSolo(trackId);
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleLock(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, {
      locked: !t.locked,
    });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleVisibility(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t && t.kind === 'video') {
    timelineStore.updateTrackProperties(trackId, {
      videoHidden: !t.videoHidden,
    });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

// Add Tracks
function addVideoTrack() {
  const videoCount = tracks.value.filter((t) => t.kind === 'video').length;
  timelineStore.addTrack('video', `Video ${videoCount + 1}`);
  timelineStore.requestTimelineSave({ immediate: true });
}

function addAudioTrack() {
  const audioCount = tracks.value.filter((t) => t.kind === 'audio').length;
  timelineStore.addTrack('audio', `Audio ${audioCount + 1}`);
  timelineStore.requestTimelineSave({ immediate: true });
}

const isDragging = ref(false);

// `@types/sortablejs` isn't resolvable here, so DraggableEvent loses the base
// SortableEvent fields. Re-declare the ones we read on top of it.
type TrackDragEndEvent = DraggableEvent & {
  originalEvent?: MouseEvent | TouchEvent;
  oldIndex?: number;
};

function handleDragEnd(event: TrackDragEndEvent) {
  isDragging.value = false;

  const originalEvent = event.originalEvent;
  if (!originalEvent || event.oldIndex === undefined) return;

  const point =
    (originalEvent as TouchEvent).changedTouches?.[0] ??
    (originalEvent as TouchEvent).touches?.[0] ??
    (originalEvent as MouseEvent);
  if (point.clientX === undefined || point.clientY === undefined) return;

  const element = document.elementFromPoint(point.clientX, point.clientY);
  const isOverDeleteZone = element?.closest('.delete-drop-zone');

  if (isOverDeleteZone) {
    const track = localTracks.value[event.oldIndex];
    if (track) {
      requestDeleteTrack(track);
    }
  }
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :ui="{ body: 'no-scrollbar' }">
    <div class="px-4 py-4 flex flex-col h-full overflow-hidden">
      <!-- Empty State -->
      <div v-if="localTracks.length === 0" class="flex-1 flex items-center justify-center py-8">
        <p class="text-sm text-ui-text-muted">{{ t('fastcat.timeline.noTracks') }}</p>
      </div>

      <!-- Drag & Drop List -->
      <div v-else class="flex-1 overflow-y-auto pr-1 no-scrollbar mb-4">
        <VueDraggable
          v-model="localTracks"
          handle=".drag-handle"
          :animation="150"
          class="space-y-2"
          @start="isDragging = true"
          @end="handleDragEnd"
        >
          <div
            v-for="track in localTracks"
            :key="track.id"
            class="flex items-center gap-2 bg-ui-bg-elevated/40 border border-ui-border rounded-xl p-3 transition-colors hover:bg-ui-bg-elevated/60"
          >
            <!-- Drag Handle -->
            <div
              class="drag-handle p-1 text-ui-text-muted hover:text-ui-text cursor-grab active:cursor-grabbing shrink-0"
            >
              <UIcon name="i-heroicons-bars-2" class="w-5 h-5" />
            </div>

            <!-- Kind Icon -->
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-semibold text-xs"
              :style="{
                backgroundColor:
                  track.color && track.color !== '#2a2a2a' ? `${track.color}33` : '#1e293b',
                color: track.color && track.color !== '#2a2a2a' ? track.color : '#94a3b8',
              }"
            >
              <UIcon
                :name="
                  track.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note'
                "
                class="w-4 h-4"
              />
            </div>

            <!-- Track Name (Tap to Rename) -->
            <span
              class="flex-1 text-sm font-medium text-ui-text truncate px-1 cursor-pointer hover:underline"
              :title="track.name || track.id"
              @click="openRename(track)"
            >
              {{ track.name || track.id }}
            </span>

            <!-- Actions -->
            <div class="flex items-center gap-1.5 shrink-0">
              <!-- Visibility (Video only) -->
              <UButton
                v-if="track.kind === 'video'"
                :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                variant="ghost"
                color="neutral"
                size="sm"
                :class="track.videoHidden ? 'text-error-500' : 'text-ui-text-muted'"
                @click="toggleVisibility(track.id)"
              />

              <!-- Mute -->
              <UButton
                :icon="track.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
                variant="ghost"
                color="neutral"
                size="sm"
                :class="track.audioMuted ? 'text-error-500' : 'text-ui-text-muted'"
                @click="toggleMute(track.id)"
              />

              <!-- Solo -->
              <UButton
                icon="i-heroicons-musical-note"
                variant="ghost"
                color="neutral"
                size="sm"
                :class="track.audioSolo ? 'text-success-500' : 'text-ui-text-muted'"
                @click="toggleSolo(track.id)"
              />

              <!-- Lock -->
              <UButton
                :icon="track.locked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
                variant="ghost"
                color="neutral"
                size="sm"
                :class="track.locked ? 'text-blue-500' : 'text-ui-text-muted'"
                @click="toggleLock(track.id)"
              />
            </div>
          </div>
        </VueDraggable>
      </div>

      <!-- Bottom block -->
      <div class="pt-4 border-t border-ui-border/50 shrink-0 min-h-[58px] relative overflow-hidden">
        <!-- Delete drop zone (during drag) -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="transform translate-y-4 opacity-0"
          enter-to-class="transform translate-y-0 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="transform translate-y-0 opacity-100"
          leave-to-class="transform translate-y-4 opacity-0"
        >
          <div
            v-if="isDragging"
            class="delete-drop-zone absolute inset-x-0 bottom-0 top-0 flex items-center justify-center gap-2 rounded-xl bg-error-500/10 border-2 border-dashed border-error-500/40 text-error-400 font-bold text-sm select-none"
          >
            <UIcon name="i-heroicons-trash" class="w-5 h-5 text-error-500 animate-pulse" />
            <span>{{ t('fastcat.timeline.dropHereToDelete') }}</span>
          </div>
        </Transition>

        <!-- Add Track Buttons (when not dragging) -->
        <div v-show="!isDragging" class="flex gap-2 w-full">
          <UButton
            icon="i-heroicons-video-camera"
            :label="t('fastcat.timeline.addVideoTrack')"
            variant="soft"
            color="neutral"
            size="md"
            class="flex-1 justify-center py-2.5 rounded-xl text-sm"
            @click="addVideoTrack"
          />
          <UButton
            icon="i-heroicons-musical-note"
            :label="t('fastcat.timeline.addAudioTrack')"
            variant="soft"
            color="neutral"
            size="md"
            class="flex-1 justify-center py-2.5 rounded-xl text-sm"
            @click="addAudioTrack"
          />
        </div>
      </div>
    </div>

    <!-- Modals -->
    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteTrackTitle')"
      :description="t('fastcat.timeline.deleteTrackDescription')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete')"
      @confirm="confirmDeleteTrack"
    />

    <UiRenameModal
      v-if="trackToRename"
      :open="isRenameOpen"
      :current-name="trackToRename.name || ''"
      :title="t('fastcat.timeline.renameTrack')"
      @update:open="isRenameOpen = $event"
      @rename="handleRename"
    />
  </UiMobileDrawer>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
