<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';
import { isSecondaryWheel, getWheelDelta } from '~/utils/mouse';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import AppModal from '~/components/ui/AppModal.vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'update:trackHeight', trackId: string, height: number): void;
  (e: 'scroll', event: Event): void;
}>();

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const settingsStore = useTimelineSettingsStore();
const workspaceStore = useWorkspaceStore();

const DEFAULT_TRACK_HEIGHT = 40;
const MIN_TRACK_HEIGHT = 32;
const MAX_TRACK_HEIGHT = 300;

const labelsScrollContainer = ref<HTMLElement | null>(null);

defineExpose({
  labelsScrollContainer,
});

const resizingTrackId = ref<string | null>(null);
const startY = ref(0);
const startHeight = ref(0);

function onResizeStart(trackId: string, e: MouseEvent) {
  resizingTrackId.value = trackId;
  startY.value = e.clientY;
  startHeight.value = props.trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT;

  window.addEventListener('mousemove', onGlobalMouseMove);
  window.addEventListener('mouseup', onGlobalMouseUp);
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!resizingTrackId.value) return;
  const dy = e.clientY - startY.value;
  const nextHeight = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, startHeight.value + dy));
  emit('update:trackHeight', resizingTrackId.value, nextHeight);
}

function onGlobalMouseUp() {
  resizingTrackId.value = null;
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
}

const isConfirmDeleteOpen = ref(false);
const isRenameOpen = ref(false);
const renameValue = ref('');
const contextTrackId = ref<string | null>(null);

const selectedTrackId = computed(() => timelineStore.selectedTrackId);

function onSelectTrack(trackId: string) {
  timelineStore.selectTrack(trackId);
  selectionStore.selectTimelineTrack(trackId);
}

function toggleVideoHidden(track: TimelineTrack, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  timelineStore.toggleVideoHidden(track.id);
}

function toggleAudioMuted(track: TimelineTrack, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  timelineStore.toggleTrackAudioMuted(track.id);
}

function toggleAudioSolo(track: TimelineTrack, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  timelineStore.toggleTrackAudioSolo(track.id);
}

const selectedTrack = computed(() => {
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  const id = contextTrackId.value ?? timelineStore.selectedTrackId;
  return docTracks.find((tr) => tr.id === id) ?? null;
});

const canDeleteSelectedTrackWithoutConfirm = computed(() =>
  Boolean(selectedTrack.value && selectedTrack.value.items.length === 0),
);

function openRename(track: TimelineTrack) {
  contextTrackId.value = track.id;
  onSelectTrack(track.id);
  renameValue.value = track.name;
  isRenameOpen.value = true;
}

function confirmRename() {
  if (!selectedTrack.value) return;
  const next = renameValue.value.trim();
  if (!next) return;
  timelineStore.renameTrack(selectedTrack.value.id, next);
  isRenameOpen.value = false;
  contextTrackId.value = null;
}

function requestDelete(track: TimelineTrack) {
  contextTrackId.value = track.id;
  onSelectTrack(track.id);
  if (canDeleteSelectedTrackWithoutConfirm.value) {
    timelineStore.deleteTrack(track.id);
    contextTrackId.value = null;
    return;
  }
  isConfirmDeleteOpen.value = true;
}

function confirmDelete() {
  if (!selectedTrack.value) return;
  timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
  isConfirmDeleteOpen.value = false;
  contextTrackId.value = null;
}

function getTrackContextMenuItems(track: TimelineTrack) {
  const addItems =
    track.kind === 'video'
      ? [
          {
            label: t('granVideoEditor.timeline.addVideoTrackAbove', 'Add video track above'),
            icon: 'i-heroicons-video-camera',
            onSelect: () => {
              const idx = props.tracks.filter((tr) => tr.kind === 'video').length + 1;
              timelineStore.addTrack('video', `Video ${idx}`, { insertBeforeId: track.id });
            },
          },
          {
            label: t('granVideoEditor.timeline.addVideoTrackBelow', 'Add video track below'),
            icon: 'i-heroicons-video-camera',
            onSelect: () => {
              const idx = props.tracks.filter((tr) => tr.kind === 'video').length + 1;
              timelineStore.addTrack('video', `Video ${idx}`, { insertAfterId: track.id });
            },
          },
        ]
      : [
          {
            label: t('granVideoEditor.timeline.addAudioTrackAbove', 'Add audio track above'),
            icon: 'i-heroicons-musical-note',
            onSelect: () => {
              const idx = props.tracks.filter((tr) => tr.kind === 'audio').length + 1;
              timelineStore.addTrack('audio', `Audio ${idx}`, { insertBeforeId: track.id });
            },
          },
          {
            label: t('granVideoEditor.timeline.addAudioTrackBelow', 'Add audio track below'),
            icon: 'i-heroicons-musical-note',
            onSelect: () => {
              const idx = props.tracks.filter((tr) => tr.kind === 'audio').length + 1;
              timelineStore.addTrack('audio', `Audio ${idx}`, { insertAfterId: track.id });
            },
          },
        ];

  return [
    addItems,
    [
      {
        label: t('granVideoEditor.timeline.renameTrack', 'Rename track'),
        icon: 'i-heroicons-pencil',
        onSelect: () => openRename(track),
      },
      {
        label: t('granVideoEditor.timeline.deleteTrack', 'Delete track'),
        icon: 'i-heroicons-trash',
        onSelect: () => requestDelete(track),
      },
    ],
  ];
}

function onDragStart(e: DragEvent, track: TimelineTrack) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(
    'application/json',
    JSON.stringify({ kind: 'timeline-track', trackId: track.id }),
  );
  e.dataTransfer.effectAllowed = 'move';
}

function onDrop(e: DragEvent, targetTrack: TimelineTrack) {
  const raw = e.dataTransfer?.getData('application/json');
  if (!raw) return;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (parsed?.kind !== 'timeline-track') return;
  const sourceId = String(parsed?.trackId ?? '');
  if (!sourceId) return;
  if (sourceId === targetTrack.id) return;

  const sourceTrack = props.tracks.find((t) => t.id === sourceId);
  if (!sourceTrack) return;
  if (sourceTrack.kind !== targetTrack.kind) return;

  const sameKindTracks = props.tracks.filter((t) => t.kind === targetTrack.kind);
  const sourceIdx = sameKindTracks.findIndex((t) => t.id === sourceTrack.id);
  const targetIdx = sameKindTracks.findIndex((t) => t.id === targetTrack.id);
  if (sourceIdx === -1 || targetIdx === -1) return;

  const nextSameKind = [...sameKindTracks];
  nextSameKind.splice(sourceIdx, 1);
  nextSameKind.splice(targetIdx, 0, sourceTrack);

  const otherKind = props.tracks.filter((t) => t.kind !== targetTrack.kind);
  const nextTracks =
    targetTrack.kind === 'video'
      ? [...nextSameKind, ...otherKind]
      : [...otherKind, ...nextSameKind];

  timelineStore.reorderTracks(nextTracks.map((t) => t.id));
}
function addVideoTrack() {
  const idx = props.tracks.filter((tr) => tr.kind === 'video').length + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function addAudioTrack() {
  const idx = props.tracks.filter((tr) => tr.kind === 'audio').length + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}

const emptyAreaContextMenuItems = computed(() => {
  return [
    [
      {
        label: t('granVideoEditor.timeline.addVideoTrack', 'Add video track'),
        icon: 'i-heroicons-video-camera',
        onSelect: addVideoTrack,
      },
      {
        label: t('granVideoEditor.timeline.addAudioTrack', 'Add audio track'),
        icon: 'i-heroicons-musical-note',
        onSelect: addAudioTrack,
      },
    ],
  ];
});
function onTrackWheel(e: WheelEvent, track: TimelineTrack) {
  const isShift = e.shiftKey;
  const isSecondary = isSecondaryWheel(e);

  const settings = workspaceStore.userSettings.mouse.timeline;

  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  // Calculate delta amount based on event
  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  if (action === 'zoom_vertical') {
    e.preventDefault();
    e.stopPropagation();

    const dir = delta < 0 ? 1 : -1;
    const step = 10;

    const docTracks = timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined;
    if (!docTracks) return;

    for (const t of docTracks) {
      const currentHeight = props.trackHeights[t.id] ?? DEFAULT_TRACK_HEIGHT;
      const nextHeight = Math.max(
        MIN_TRACK_HEIGHT,
        Math.min(MAX_TRACK_HEIGHT, currentHeight + dir * step),
      );
      emit('update:trackHeight', t.id, nextHeight);
    }
    return;
  }

  // Handle older behavior as fallback
  if (isSecondary || (!e.shiftKey && e.deltaY === 0)) return;

  e.preventDefault();
  e.stopPropagation();

  const dir = delta < 0 ? 1 : -1;
  const step = 10;

  const currentHeight = props.trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT;
  const nextHeight = Math.max(
    MIN_TRACK_HEIGHT,
    Math.min(MAX_TRACK_HEIGHT, currentHeight + dir * step),
  );

  emit('update:trackHeight', track.id, nextHeight);
}

function toggleOverlapMode() {
  settingsStore.setOverlapMode(settingsStore.overlapMode === 'none' ? 'pseudo' : 'none');
}

function toggleFrameSnapMode() {
  settingsStore.setFrameSnapMode(settingsStore.frameSnapMode === 'frames' ? 'free' : 'frames');
}

function toggleClipSnapMode() {
  settingsStore.setClipSnapMode(settingsStore.clipSnapMode === 'clips' ? 'none' : 'clips');
}
</script>

<template>
  <div
    class="h-full w-full shrink-0 border-r border-ui-border flex flex-col bg-ui-bg"
    v-bind="$attrs"
  >
    <UContextMenu
      :items="[
        [
          {
            label: t('granVideoEditor.timeline.addVideoTrack', 'Add video track'),
            icon: 'i-heroicons-video-camera',
            onSelect: addVideoTrack,
          },
          {
            label: t('granVideoEditor.timeline.addAudioTrack', 'Add audio track'),
            icon: 'i-heroicons-musical-note',
            onSelect: addAudioTrack,
          },
        ],
      ]"
    >
      <div
        class="h-7 border-b border-ui-border bg-ui-bg-elevated flex items-center px-1 shrink-0 gap-0.5"
      >
        <UTooltip :text="t('granVideoEditor.timeline.addVideoTrack', 'Add video track')">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-video-camera"
            @click="addVideoTrack"
          />
        </UTooltip>
        <UTooltip :text="t('granVideoEditor.timeline.addAudioTrack', 'Add audio track')">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-musical-note"
            @click="addAudioTrack"
          />
        </UTooltip>

        <div class="flex items-center gap-0.5 ml-auto">
          <UTooltip
            :text="
              settingsStore.overlapMode === 'pseudo'
                ? t('granVideoEditor.timeline.overlayModePseudo', 'Pseudo-overlay mode')
                : t('granVideoEditor.timeline.overlayModeNone', 'Normal mode')
            "
          >
            <UButton
              size="xs"
              :variant="settingsStore.overlapMode === 'pseudo' ? 'solid' : 'ghost'"
              :color="settingsStore.overlapMode === 'pseudo' ? 'primary' : 'neutral'"
              icon="i-heroicons-squares-2x2"
              :aria-label="
                settingsStore.overlapMode === 'pseudo'
                  ? t('granVideoEditor.timeline.overlayModePseudo', 'Pseudo-overlay mode (active)')
                  : t('granVideoEditor.timeline.overlayModeNone', 'Normal mode (no overlap)')
              "
              @click="toggleOverlapMode"
            />
          </UTooltip>

          <div class="w-px h-3.5 bg-ui-border mx-0.5" />

          <UTooltip
            :text="
              settingsStore.frameSnapMode === 'frames'
                ? t('granVideoEditor.timeline.frameSnapOn', 'Snap to frames')
                : t('granVideoEditor.timeline.frameSnapOff', 'Free placement')
            "
          >
            <UButton
              size="xs"
              :variant="settingsStore.frameSnapMode === 'frames' ? 'solid' : 'ghost'"
              :color="settingsStore.frameSnapMode === 'frames' ? 'primary' : 'neutral'"
              icon="i-heroicons-film"
              :aria-label="
                settingsStore.frameSnapMode === 'frames'
                  ? t('granVideoEditor.timeline.frameSnapOn', 'Snap to frames (active)')
                  : t('granVideoEditor.timeline.frameSnapOff', 'Free placement (no frame snap)')
              "
              @click="toggleFrameSnapMode"
            />
          </UTooltip>

          <UTooltip
            :text="
              settingsStore.clipSnapMode === 'clips'
                ? t('granVideoEditor.timeline.clipSnapOn', 'Snap to clips')
                : t('granVideoEditor.timeline.clipSnapOff', 'No clip snapping')
            "
          >
            <UButton
              size="xs"
              :variant="settingsStore.clipSnapMode === 'clips' ? 'solid' : 'ghost'"
              :color="settingsStore.clipSnapMode === 'clips' ? 'primary' : 'neutral'"
              icon="i-heroicons-link"
              :aria-label="
                settingsStore.clipSnapMode === 'clips'
                  ? t('granVideoEditor.timeline.clipSnapOn', 'Snap to clips (active)')
                  : t('granVideoEditor.timeline.clipSnapOff', 'No clip snapping')
              "
              @click="toggleClipSnapMode"
            />
          </UTooltip>

          <div class="w-px h-3.5 bg-ui-border mx-0.5" />
        </div>
      </div>
    </UContextMenu>
    <div ref="labelsScrollContainer" class="flex-1 overflow-y-scroll overflow-x-hidden labels-scroll-container" @scroll="emit('scroll', $event)">
      <div class="flex flex-col divide-y divide-ui-border min-h-full pb-16">
        <UContextMenu
          v-for="track in tracks"
          :key="track.id"
          :items="getTrackContextMenuItems(track)"
        >
          <div
            class="flex items-center px-2 text-xs font-medium cursor-pointer select-none relative group"
            :class="
              selectedTrackId === track.id
                ? 'text-ui-text bg-ui-bg-accent'
                : timelineStore.hoveredTrackId === track.id
                  ? 'text-ui-text bg-ui-bg-elevated/80'
                  : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated'
            "
            :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
            draggable="true"
            @dragstart="onDragStart($event, track)"
            @dragover.prevent
            @drop.prevent="onDrop($event, track)"
            @click="onSelectTrack(track.id)"
            @contextmenu="onSelectTrack(track.id)"
            @wheel="onTrackWheel($event, track)"
            @mouseenter="timelineStore.hoveredTrackId = track.id"
            @mouseleave="timelineStore.hoveredTrackId = null"
          >
            <span class="truncate" :title="track.name">{{ track.name }}</span>

            <div class="ml-auto flex items-center gap-1">
              <UButton
                v-if="track.kind === 'video'"
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                :aria-label="
                  t('granVideoEditor.timeline.toggleTrackVisibility', 'Toggle track visibility')
                "
                @pointerdown.prevent.stop
                @mousedown.prevent.stop
                @click="toggleVideoHidden(track, $event)"
              />

              <UButton
                size="xs"
                variant="ghost"
                :color="track.audioMuted ? 'error' : 'neutral'"
                :icon="track.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
                :aria-label="t('granVideoEditor.timeline.toggleTrackMute', 'Toggle track mute')"
                @pointerdown.prevent.stop
                @mousedown.prevent.stop
                @click="toggleAudioMuted(track, $event)"
              />

              <UButton
                size="xs"
                variant="ghost"
                :color="track.audioSolo ? 'primary' : 'neutral'"
                icon="i-heroicons-musical-note"
                :aria-label="t('granVideoEditor.timeline.toggleTrackSolo', 'Toggle track solo')"
                @pointerdown.prevent.stop
                @mousedown.prevent.stop
                @click="toggleAudioSolo(track, $event)"
              />
            </div>

            <!-- Bottom resize handle -->
            <div
              class="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-20 hover:bg-primary-500/50 transition-colors"
              @mousedown.stop.prevent="onResizeStart(track.id, $event)"
            />
          </div>
        </UContextMenu>

        <UContextMenu :items="emptyAreaContextMenuItems" class="flex-1">
          <div class="w-full h-full" />
        </UContextMenu>
      </div>
    </div>
  </div>

  <UiConfirmModal
    v-if="selectedTrack"
    v-model:open="isConfirmDeleteOpen"
    :title="t('granVideoEditor.timeline.deleteTrackTitle', 'Delete track?')"
    :description="
      t(
        'granVideoEditor.timeline.deleteTrackDescription',
        'Track is not empty. This action cannot be undone.',
      )
    "
    color="error"
    icon="i-heroicons-exclamation-triangle"
    :confirm-text="t('common.delete', 'Delete')"
    @confirm="confirmDelete"
  />

  <AppModal
    v-if="selectedTrack"
    v-model:open="isRenameOpen"
    :title="t('granVideoEditor.timeline.renameTrackTitle', 'Rename track')"
  >
    <div class="flex flex-col gap-3">
      <UInput
        v-model="renameValue"
        size="sm"
        :placeholder="t('granVideoEditor.timeline.trackName', 'Track name')"
        @keydown.enter.prevent="confirmRename"
      />
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="isRenameOpen = false">
        {{ t('common.cancel', 'Cancel') }}
      </UButton>
      <UButton color="primary" @click="confirmRename">
        {{ t('common.save', 'Save') }}
      </UButton>
    </template>
  </AppModal>
</template>

<style scoped>
/* Hide scrollbar while keeping scroll functionality for JS-synced scroll */
.labels-scroll-container::-webkit-scrollbar {
  display: none;
}
.labels-scroll-container {
  scrollbar-width: none;
}
</style>
