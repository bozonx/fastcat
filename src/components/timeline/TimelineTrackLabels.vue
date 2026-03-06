<script setup lang="ts">
import { computed, ref, nextTick, watch, onBeforeUnmount, provide } from 'vue';

import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';
import { isSecondaryWheel, getWheelDelta } from '~/utils/mouse';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { frameToUs, sanitizeFps } from '~/timeline/commands/utils';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';

const { t } = useI18n();

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  scrollbarCompensation?: number;
}>();

const emit = defineEmits<{
  (e: 'update:trackHeight', trackId: string, height: number): void;
  (e: 'scroll', event: Event): void;
}>();

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const settingsStore = useTimelineSettingsStore();
const workspaceStore = useWorkspaceStore();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();

// Provide dummy tooltip context for testing purposes without needing a TooltipProvider wrapper
if (process.env.NODE_ENV === 'test') {
  provide(Symbol.for('TooltipProviderContext'), {
    delayDuration: ref(700),
    disableHoverableContent: ref(false),
    disableClosingTrigger: ref(false),
    onOpen: () => {},
    onClose: () => {},
    isOpen: () => false,
    onTriggerEnter: () => {},
    onTriggerLeave: () => {},
  });
}

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

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onGlobalMouseMove);
  window.removeEventListener('mouseup', onGlobalMouseUp);
});

const isConfirmDeleteOpen = ref(false);
const contextTrackId = ref<string | null>(null);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

watch(
  () => timelineStore.renamingTrackId,
  async (newId) => {
    if (newId) {
      const track = props.tracks.find((t) => t.id === newId);
      if (track) {
        renameValue.value = track.name;
        await nextTick();
        if (renameInput.value) {
          renameInput.value.focus();
          // Give browser a tiny bit of time to settle focus
          setTimeout(() => {
            renameInput.value?.select();
          }, 30);
        }
      }
    }
  },
);

const selectedTrackId = computed(() => timelineStore.selectedTrackId);

function onSelectTrack(trackId: string) {
  if (timelineStore.selectedTrackId !== trackId) {
    timelineStore.selectTrack(trackId);
    selectionStore.selectTimelineTrack(trackId);
    return;
  }

  const entity = selectionStore.selectedEntity;
  const isTimelinePropsSelected =
    entity?.source === 'timeline' && entity.kind === 'timeline-properties';
  if (isTimelinePropsSelected) {
    timelineStore.selectTrack(trackId);
    selectionStore.selectTimelineTrack(trackId);
    return;
  }

  timelineStore.selectTimelineProperties();
}

function selectTimelineProperties() {
  timelineStore.selectTimelineProperties();
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

async function openRename(track: TimelineTrack) {
  contextTrackId.value = track.id;
  onSelectTrack(track.id);
  timelineStore.renamingTrackId = track.id;
}

function confirmRename() {
  if (!timelineStore.renamingTrackId || !selectedTrack.value) return;
  const next = renameValue.value.trim();
  if (next) {
    timelineStore.renameTrack(selectedTrack.value.id, next);
  }
  cancelRename();
}

function cancelRename() {
  timelineStore.renamingTrackId = null;
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

function seekByWheelDelta(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;

  const direction = delta < 0 ? 1 : -1;
  const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
  const frameStepUs = frameToUs(1, fps);

  return {
    frame: () => timelineStore.setCurrentTimeUs(timelineStore.currentTime + direction * frameStepUs),
    second: () => timelineStore.setCurrentTimeUs(timelineStore.currentTime + direction * 1_000_000),
  };
}

function onTrackAreaWheel(e: WheelEvent) {
  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const isSecondary = isSecondaryWheel(e);
  const settings = workspaceStore.userSettings.mouse.trackHeaders;

  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  if (action === 'scroll_vertical') {
    // Let browser handle vertical scrolling natively
    if (!isSecondary && !isShift) return;

    e.preventDefault();
    if (labelsScrollContainer.value) {
      labelsScrollContainer.value.scrollTop += delta;
    }
    return;
  }

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

  if (action === 'seek_frame') {
    e.preventDefault();
    e.stopPropagation();
    seekByWheelDelta(delta)?.frame();
    return;
  }

  if (action === 'seek_second') {
    e.preventDefault();
    e.stopPropagation();
    seekByWheelDelta(delta)?.second();
  }
}

function onTrackWheel(e: WheelEvent, track: TimelineTrack) {
  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const isSecondary = isSecondaryWheel(e);
  const settings = workspaceStore.userSettings.mouse.trackHeaders;

  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  // Let onTrackAreaWheel handle global zoom and scroll
  if (action === 'zoom_vertical' || action === 'scroll_vertical') {
    return;
  }

  if (action === 'resize_track') {
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
    return;
  }

  if (action === 'seek_frame') {
    e.preventDefault();
    e.stopPropagation();
    seekByWheelDelta(delta)?.frame();
    return;
  }

  if (action === 'seek_second') {
    e.preventDefault();
    e.stopPropagation();
    seekByWheelDelta(delta)?.second();
  }
}

function onVirtualClipDragStart(e: DragEvent, kind: 'adjustment' | 'background' | 'text') {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        kind,
        name: t(`granVideoEditor.timeline.${kind}ClipDefaultName`, kind),
        path: '',
      }),
    );
  }

  const labels: Record<string, string> = {
    adjustment: t('granVideoEditor.timeline.adjustmentClipDefaultName', 'Adjustment'),
    background: t('granVideoEditor.timeline.backgroundClipDefaultName', 'Background'),
    text: t('granVideoEditor.timeline.textClipDefaultName', 'Text'),
  };

  setDraggedFile({
    kind,
    name: labels[kind] ?? kind,
    path: '',
  });
}

function onVirtualClipDragEnd() {
  clearDraggedFile();
}

async function splitClips() {
  await timelineStore.splitClipsAtPlayhead();
}

async function rippleTrimLeft() {
  await timelineStore.rippleTrimLeft();
}

async function rippleTrimRight() {
  await timelineStore.rippleTrimRight();
}

function addAdjustmentClip() {
  timelineStore.addAdjustmentClipAtPlayhead();
}

function addBackgroundClip() {
  timelineStore.addBackgroundClipAtPlayhead();
}

function addTextClip() {
  const defaultName = t('granVideoEditor.timeline.textClipDefaultName', 'Text');
  const defaultText = t('granVideoEditor.timeline.textClipDefaultText', 'Text');
  timelineStore.addTextClipAtPlayhead({ name: defaultName, text: defaultText });
}

const trimMenuItems = computed(() => [
  [
    {
      label: t('granVideoEditor.timeline.rippleTrimLeft', 'Ripple trim left'),
      icon: 'i-heroicons-arrow-left',
      onSelect: rippleTrimLeft,
    },
    {
      label: t('granVideoEditor.timeline.rippleTrimRight', 'Ripple trim right'),
      icon: 'i-heroicons-arrow-right',
      onSelect: rippleTrimRight,
    },
  ],
]);

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
        <div class="flex items-center gap-0.5 min-w-0 flex-1">
          <UTooltip :text="t('granVideoEditor.timeline.properties.title', 'Timeline properties')">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-cog-6-tooth"
              @click="selectTimelineProperties"
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

          <div class="ml-auto flex items-center gap-0.5">
            <UTooltip :text="t('granVideoEditor.timeline.trim', 'Trim')">
              <UiSplitDropdownButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-scissors"
                :ariaLabel="t('granVideoEditor.timeline.splitClips', 'Split clips at playhead')"
                :caretAriaLabel="t('granVideoEditor.timeline.trimOptions', 'Trim options')"
                :items="trimMenuItems"
                @click="splitClips"
              />
            </UTooltip>

            <div
              draggable="true"
              class="cursor-grab active:cursor-grabbing"
              @dragstart="onVirtualClipDragStart($event, 'adjustment')"
              @dragend="onVirtualClipDragEnd"
            >
              <UTooltip
                :text="t('granVideoEditor.timeline.addAdjustmentClip', 'Add adjustment clip')"
              >
                <UButton
                  draggable="true"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-adjustments-horizontal"
                  :aria-label="t('granVideoEditor.timeline.addAdjustmentClip', 'Add adjustment clip')"
                  @dragstart="onVirtualClipDragStart($event, 'adjustment')"
                  @dragend="onVirtualClipDragEnd"
                  @click="addAdjustmentClip"
                />
              </UTooltip>
            </div>

            <div
              draggable="true"
              class="cursor-grab active:cursor-grabbing"
              @dragstart="onVirtualClipDragStart($event, 'background')"
              @dragend="onVirtualClipDragEnd"
            >
              <UTooltip
                :text="t('granVideoEditor.timeline.addBackgroundClip', 'Add background clip')"
              >
                <UButton
                  draggable="true"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-swatch"
                  :aria-label="t('granVideoEditor.timeline.addBackgroundClip', 'Add background clip')"
                  @dragstart="onVirtualClipDragStart($event, 'background')"
                  @dragend="onVirtualClipDragEnd"
                  @click="addBackgroundClip"
                />
              </UTooltip>
            </div>

            <div
              draggable="true"
              class="cursor-grab active:cursor-grabbing"
              @dragstart="onVirtualClipDragStart($event, 'text')"
              @dragend="onVirtualClipDragEnd"
            >
              <UTooltip :text="t('granVideoEditor.timeline.addTextClip', 'Add text clip')">
                <UButton
                  draggable="true"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-chat-bubble-bottom-center-text"
                  :aria-label="t('granVideoEditor.timeline.addTextClip', 'Add text clip')"
                  @dragstart="onVirtualClipDragStart($event, 'text')"
                  @dragend="onVirtualClipDragEnd"
                  @click="addTextClip"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </div>
    </UContextMenu>
    <div
      ref="labelsScrollContainer"
      class="flex-1 overflow-y-scroll overflow-x-hidden labels-scroll-container"
      @scroll="emit('scroll', $event)"
      @click="selectTimelineProperties"
    >
      <div class="flex flex-col min-h-full">
        <UContextMenu
          v-for="track in tracks"
          :key="track.id"
          :items="getTrackContextMenuItems(track)"
        >
          <div
            class="flex items-center px-2 text-xs font-medium cursor-pointer select-none relative group border-b border-ui-border"
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
            @click.stop="onSelectTrack(track.id)"
            @contextmenu="onSelectTrack(track.id)"
            @wheel="onTrackWheel($event, track)"
            @mouseenter="timelineStore.hoveredTrackId = track.id"
            @mouseleave="timelineStore.hoveredTrackId = null"
          >
            <div
              class="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-dashed border-transparent transition-colors group/name cursor-text"
              :class="[
                timelineStore.renamingTrackId === track.id
                  ? 'bg-ui-bg-elevated border-solid border-ui-border-accent'
                  : 'hover:border-ui-border-accent/60',
              ]"
              @click.stop="openRename(track)"
            >
              <input
                v-if="timelineStore.renamingTrackId === track.id"
                :ref="
                  (el) => {
                    if (el) renameInput = el as HTMLInputElement;
                  }
                "
                v-model="renameValue"
                class="w-full bg-transparent border-none outline-none text-xs font-medium p-0 m-0 block"
                @keydown.enter.stop="confirmRename"
                @keydown.esc.stop="cancelRename"
                @blur="confirmRename"
              />
              <span v-else class="truncate block" :title="track.name">{{ track.name }}</span>
            </div>

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

        <!-- Empty clickable area below tracks, matches TimelineTracks.vue min-h-50 -->
        <UContextMenu :items="emptyAreaContextMenuItems" class="flex-1 flex flex-col min-h-0">
          <div class="w-full flex-1 min-h-7" @click="selectTimelineProperties" />
        </UContextMenu>

        <!-- Padding at the bottom for scroll space, matches TimelineTracks.vue pb-16 -->
        <div class="h-16 shrink-0" />

        <!-- Scrollbar compensation to align exactly with tracks scroll area -->
        <div
          v-if="scrollbarCompensation"
          class="shrink-0"
          :style="{ height: `${scrollbarCompensation}px` }"
        />
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
