<script setup lang="ts">
import ClipTransitionPanel from './ClipTransitionPanel.vue';
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, pxToDeltaUs } from '~/composables/timeline/useTimelineInteraction';
import AppModal from '~/components/ui/AppModal.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const { selectedTransition } = storeToRefs(timelineStore);

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
  movePreview?: {
    itemId: string;
    trackId: string;
    startUs: number;
  } | null;
}>();

const DEFAULT_TRACK_HEIGHT = 40;

const movePreviewResolved = computed(() => {
  const mp = props.movePreview;
  if (!mp) return null;
  const targetTrack = props.tracks.find((t) => t.id === mp.trackId);
  if (!targetTrack) return null;

  const clip = props.tracks
    .flatMap((t) => t.items)
    .find((it) => it.id === mp.itemId && it.kind === 'clip');
  if (!clip || clip.kind !== 'clip') return null;
  return {
    trackId: targetTrack.id,
    itemId: clip.id,
    startUs: mp.startUs,
    durationUs: clip.timelineRange.durationUs,
    label: clip.name,
    trackKind: targetTrack.kind,
    clipType: (clip as any).clipType as any,
  };
});

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (
    e: 'clipAction',
    payload: {
      action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
      trackId: string;
      itemId: string;
      videoItemId?: string;
    },
  ): void;
  (
    e: 'startTrimItem',
    event: MouseEvent,
    payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ): void;
}>();

// --- Transition panel popup ---
const openTransitionPanel = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  anchorEl: HTMLElement | null;
} | null>(null);

const speedModal = ref<{
  open: boolean;
  trackId: string;
  itemId: string;
  speed: number;
} | null>(null);

const speedModalOpen = computed({
  get: () => Boolean(speedModal.value?.open),
  set: (v) => {
    if (!speedModal.value) return;
    speedModal.value.open = v;
  },
});

const speedModalSpeed = computed({
  get: () => speedModal.value?.speed ?? 1,
  set: (v: number) => {
    if (!speedModal.value) return;
    speedModal.value.speed = v;
  },
});

function openSpeedModal(trackId: string, itemId: string, currentSpeed: unknown) {
  const base = typeof currentSpeed === 'number' && Number.isFinite(currentSpeed) ? currentSpeed : 1;
  speedModal.value = {
    open: true,
    trackId,
    itemId,
    speed: Math.max(0.1, Math.min(10, base)),
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const speed = Number(speedModal.value.speed);
  if (!Number.isFinite(speed) || speed <= 0) return;
  timelineStore.updateClipProperties(speedModal.value.trackId, speedModal.value.itemId, {
    speed: Math.max(0.1, Math.min(10, speed)),
  });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionIn: payload.transition,
    });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }
  openTransitionPanel.value = null;
}

function selectTransition(
  e: MouseEvent,
  input: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();
  timelineStore.selectTransition(input);
}

function transitionUsToPx(durationUs: number | undefined): number {
  const safeUs = typeof durationUs === 'number' && Number.isFinite(durationUs) ? durationUs : 0;
  return Math.max(8, timeUsToPx(Math.max(0, safeUs), timelineStore.timelineZoom));
}

/**
 * Returns true when this clip's transitionIn visually overlaps with the previous
 * clip's transitionOut (blend crossfade overlap). In that case we hide the transitionIn
 * SVG/icon to avoid rendering two overlapping triangles, but keep the button and
 * resize handle functional.
 */
function isCrossfadeTransitionIn(track: TimelineTrack, item: TimelineClipItem): boolean {
  if (!item.transitionIn) return false;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === item.id);
  if (idx <= 0) return false;
  const prev = ordered[idx - 1]!;
  const overlapUs = (prev.timelineRange.startUs + prev.timelineRange.durationUs) - item.timelineRange.startUs;
  return overlapUs > 0 && Boolean(prev.transitionOut);
}

// --- Resize transition by dragging ---
const resizeTransition = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  startX: number;
  startDurationUs: number;
} | null>(null);

// --- Resize audio fade by dragging ---
const resizeFade = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  startX: number;
  startFadeUs: number;
} | null>(null);

// --- Resize volume by dragging ---
const resizeVolume = ref<{
  trackId: string;
  itemId: string;
  startY: number;
  startVolume: number;
  height: number;
} | null>(null);

function startResizeVolume(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  currentVolume: number,
  clipHeight: number
) {
  e.stopPropagation();
  e.preventDefault();
  resizeVolume.value = {
    trackId,
    itemId,
    startY: e.clientY,
    startVolume: currentVolume,
    height: clipHeight,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeVolume.value) return;
    const dy = ev.clientY - resizeVolume.value.startY;
    const deltaVol = -(dy / resizeVolume.value.height) * 2;
    let newVol = resizeVolume.value.startVolume + deltaVol;
    newVol = Math.max(0, Math.min(2, newVol));

    timelineStore.updateClipProperties(trackId, itemId, {
      audioGain: newVol,
    });
  }

  function onMouseUp() {
    if (resizeVolume.value) {
      timelineStore.requestTimelineSave({ immediate: true });
    }
    resizeVolume.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function startResizeFade(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  edge: 'in' | 'out',
  currentFadeUs: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeFade.value = {
    trackId,
    itemId,
    edge,
    startX: e.clientX,
    startFadeUs: currentFadeUs,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeFade.value) return;
    const dx = ev.clientX - resizeFade.value.startX;
    // For 'in' edge: drag right = longer fade, drag left = shorter fade
    // For 'out' edge: drag left = longer fade (towards start), drag right = shorter fade
    const sign = edge === 'in' ? 1 : -1;
    const deltaPx = dx * sign;
    const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);

    const track = props.tracks.find((t) => t.id === trackId);
    const item = track?.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const maxUs = item.timelineRange.durationUs;
    let newFadeUs = resizeFade.value.startFadeUs + deltaUs;
    newFadeUs = Math.max(0, Math.min(maxUs, newFadeUs));

    const propName = edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
    timelineStore.updateClipProperties(trackId, itemId, {
      [propName]: Math.round(newFadeUs),
    });
  }

  function onMouseUp() {
    if (resizeFade.value) {
      timelineStore.requestTimelineSave({ immediate: true });
    }
    resizeFade.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  return [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
}

function getAdjacentClipForTransitionEdge(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}): { clip: TimelineClipItem; adjacent: TimelineClipItem | null } | null {
  const track = props.tracks.find((t) => t.id === input.trackId);
  if (!track) return null;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === input.itemId);
  if (idx === -1) return null;
  const clip = ordered[idx]!;
  const adjacent = input.edge === 'in' ? (idx > 0 ? ordered[idx - 1]! : null) : idx < ordered.length - 1 ? ordered[idx + 1]! : null;
  return { clip, adjacent };
}

function computeMaxResizableTransitionDurationUs(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: import('~/timeline/types').ClipTransition;
}): number {
  const resolved = getAdjacentClipForTransitionEdge({
    trackId: input.trackId,
    itemId: input.itemId,
    edge: input.edge,
  });
  if (!resolved) return 10_000_000;

  const { clip, adjacent } = resolved;
  if (!adjacent) return 10_000_000;

  // Only enforce hard max for blend crossfades (needs overlap material)
  const mode = input.currentTransition.mode ?? 'blend';
  if (mode !== 'blend') return 10_000_000;

  if (input.edge === 'in') {
    // We're resizing transitionIn of `clip` => crossfade uses previous clip tail handle.
    const prev = adjacent;
    const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
    const prevMaxEnd = prev.clipType === 'media' ? (prev as any).sourceDurationUs ?? prevSourceEnd : Number.POSITIVE_INFINITY;
    const prevTailHandleUs = Number.isFinite(prevMaxEnd)
      ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
      : 10_000_000;
    return Math.max(0, Math.min(10_000_000, prevTailHandleUs + input.currentTransition.durationUs));
  }

  // Resizing transitionOut of `clip` => uses this clip tail handle.
  const curr = clip;
  const currSourceEnd = (curr.sourceRange?.startUs ?? 0) + (curr.sourceRange?.durationUs ?? 0);
  const currMaxEnd = curr.clipType === 'media' ? (curr as any).sourceDurationUs ?? currSourceEnd : Number.POSITIVE_INFINITY;
  const currTailHandleUs = Number.isFinite(currMaxEnd)
    ? Math.max(0, Math.round(Number(currMaxEnd)) - Math.round(currSourceEnd))
    : 10_000_000;
  return Math.max(0, Math.min(10_000_000, currTailHandleUs + input.currentTransition.durationUs));
}

function startResizeTransition(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  edge: 'in' | 'out',
  currentDurationUs: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeTransition.value = {
    trackId,
    itemId,
    edge,
    startX: e.clientX,
    startDurationUs: currentDurationUs,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeTransition.value) return;
    const dx = ev.clientX - resizeTransition.value.startX;
    // For 'in' edge: drag right = longer, drag left = shorter
    // For 'out' edge: drag left = longer (towards start), drag right = shorter
    const sign = edge === 'in' ? 1 : -1;
    const deltaPx = dx * sign;
    const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);
    const minUs = 100_000; // 0.1s

    const track = props.tracks.find((t) => t.id === trackId);
    const item = track?.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const current =
      edge === 'in'
        ? (item as TimelineClipItem).transitionIn
        : (item as TimelineClipItem).transitionOut;
    if (!current) return;

    const maxUsRaw = computeMaxResizableTransitionDurationUs({
      trackId,
      itemId,
      edge,
      currentTransition: current,
    });

    if (maxUsRaw <= 0) return;
    const maxUs = Math.max(minUs, maxUsRaw);

    const newDurationUs = Math.min(
      maxUs,
      Math.max(minUs, resizeTransition.value.startDurationUs + deltaUs),
    );

    timelineStore.updateClipTransition(trackId, itemId, {
      [edge === 'in' ? 'transitionIn' : 'transitionOut']: {
        ...current,
        durationUs: Math.round(newDurationUs),
      },
    });
  }

  function onMouseUp() {
    resizeTransition.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// --- Problem detection: previous clip too short for blend transition ---
function getPrevClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter(
    (it): it is TimelineClipItem => it.kind === 'clip',
  );
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx <= 0) return null;
  return clips[idx - 1] ?? null;
}

function hasTransitionInProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionIn;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'blend') {
    const prev = getPrevClipForItem(track, item);
    if (!prev)
      return t(
        'granVideoEditor.timeline.transition.errorNoPreviousClip',
        'No previous clip to blend with',
      );

    // Gap check: clips must be adjacent (no gap > 0)
    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = clip.timelineRange.startUs - prevEndUs;
    if (gapUs > 1_000) {
      const gapSeconds = (gapUs / 1_000_000).toFixed(2);
      return t(
        'granVideoEditor.timeline.transition.errorGapBetweenClips',
        {
          gapSeconds,
        },
      );
    }

    // Duration check: prev clip must be long enough
    const prevDurS = prev.timelineRange.durationUs / 1_000_000;
    const needS = tr.durationUs / 1_000_000;
    if (prevDurS < needS) {
      return t(
        'granVideoEditor.timeline.transition.errorPrevClipTooShort',
        {
          needSeconds: needS.toFixed(2),
          haveSeconds: prevDurS.toFixed(2),
        },
      );
    }

    // Handle material check for media video clips only
    if (prev.kind === 'clip' && prev.clipType === 'media') {
      const prevClip = prev as TimelineClipItem;
      const prevSourceEnd = (prevClip.sourceRange?.startUs ?? 0) + (prevClip.sourceRange?.durationUs ?? 0);
      const prevTimelineEnd = prevClip.timelineRange.durationUs;
      const handleUs = prevSourceEnd - prevTimelineEnd;
      if (handleUs < tr.durationUs - 1_000) {
        const haveS = Math.max(0, handleUs / 1_000_000);
        return t(
          'granVideoEditor.timeline.transition.errorPrevHandleTooShort',
          {
            needSeconds: needS.toFixed(2),
            haveSeconds: haveS.toFixed(2),
          },
        );
      }
    }

    return null;
  }

  if (mode === 'composite') {
    const transitionStart = clip.timelineRange.startUs;
    const transitionEnd = transitionStart + tr.durationUs;
    const myTrackIdx = props.tracks.findIndex((t) => t.id === track.id);
    for (let i = myTrackIdx + 1; i < props.tracks.length; i++) {
      const lowerTrack = props.tracks[i]!;
      for (const it of lowerTrack.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        if (itStart < transitionStart && itEnd > transitionStart && itEnd < transitionEnd) {
          return t(
            'granVideoEditor.timeline.transition.errorCompositeLowerEndsMid',
            'A lower-track clip ends mid-transition (composite blend will be incomplete)',
          );
        }
      }
    }
    return null;
  }

  return null;
}

function hasTransitionOutProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionOut;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'composite') {
    const clipEnd = clip.timelineRange.startUs + clip.timelineRange.durationUs;
    const outStart = clipEnd - tr.durationUs;
    const myTrackIdx = props.tracks.findIndex((t) => t.id === track.id);
    for (let i = myTrackIdx + 1; i < props.tracks.length; i++) {
      const lowerTrack = props.tracks[i]!;
      for (const it of lowerTrack.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        // Lower clip starts within the transition-out window and ends after the current clip
        if (itStart > outStart && itStart < clipEnd && itEnd > clipEnd) {
          return t(
            'granVideoEditor.timeline.transition.errorCompositeLowerStartsMid',
            'A lower-track clip starts mid-transition (composite blend will be incomplete)',
          );
        }
      }
    }
  }
  return null;
}

// --- Transition visual helpers ---

/** Lower triangle: darker variant */
function getClipLowerTriColor(_item: TimelineTrackItem, _track: TimelineTrack): string {
  return 'var(--clip-lower-tri)';
}

/** Get dynamic classes for clip background and border */
function getClipClass(item: TimelineTrackItem, track: TimelineTrack): string[] {
  if (item.kind === 'gap') {
    return ['bg-ui-bg-elevated/40', 'border-ui-border', 'text-ui-text-muted', 'opacity-70'];
  }

  const clipItem = item as TimelineClipItem;
  const baseClasses = ['border', 'transition-colors'];

  if (clipItem.clipType === 'background') {
    return [
      ...baseClasses,
      'bg-[var(--clip-background-bg)]',
      'border-[var(--clip-background-border)]',
      'hover:bg-[var(--clip-background-bg-hover)]',
    ];
  }
  if (clipItem.clipType === 'adjustment') {
    return [
      ...baseClasses,
      'bg-[var(--clip-adjustment-bg)]',
      'border-[var(--clip-adjustment-border)]',
      'hover:bg-[var(--clip-adjustment-bg-hover)]',
    ];
  }
  if (track.kind === 'audio') {
    return [
      ...baseClasses,
      'bg-[var(--clip-audio-bg)]',
      'border-[var(--clip-audio-border)]',
      'hover:bg-[var(--clip-audio-bg-hover)]',
    ];
  }

  // Default video clip: indigo/primary
  return [
    ...baseClasses,
    'bg-[var(--clip-video-bg)]',
    'border-[var(--clip-video-border)]',
    'hover:bg-[var(--clip-video-bg-hover)]',
  ];
}

function transitionSvgParts(
  w: number,
  h: number,
  edge: 'in' | 'out',
): string {
  const m = h / 2;
  if (edge === 'in') {
    // Current clip absorbs previous (previous recedes right)
    // Dark triangle base on left, apex right.
    return `M0,0 L${w},${m} L0,${h} Z`;
  } else {
    // Next clip absorbs current. Body of current clip ends in a point.
    // We draw two dark triangles at the top-right and bottom-right corners.
    return `M0,0 L${w},0 L${w},${m} Z M0,${h} L${w},${h} L${w},${m} Z`;
  }
}

// --- Context menu ---
function getClipContextMenuItems(track: TimelineTrack, item: any) {
  if (!item) return [];

  if (item.kind === 'gap') {
    return [
      [
        {
          label: t('granVideoEditor.timeline.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          onSelect: () => {
            timelineStore.applyTimeline({
              type: 'delete_items',
              trackId: track.id,
              itemIds: [item.id],
            });
          },
        },
      ],
    ];
  }

  const mainGroup: any[] = [];

  if (item.kind === 'clip') {
    mainGroup.push({
      label: item.disabled
        ? t('granVideoEditor.timeline.enableClip', 'Enable clip')
        : t('granVideoEditor.timeline.disableClip', 'Disable clip'),
      icon: item.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onSelect: async () => {
        timelineStore.updateClipProperties(track.id, item.id, { disabled: !Boolean(item.disabled) });
        await timelineStore.requestTimelineSave({ immediate: true });
      },
    });

    mainGroup.push({
      label: item.locked
        ? t('granVideoEditor.timeline.unlockClip', 'Unlock clip')
        : t('granVideoEditor.timeline.lockClip', 'Lock clip'),
      icon: item.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      onSelect: async () => {
        timelineStore.updateClipProperties(track.id, item.id, { locked: !Boolean(item.locked) });
        await timelineStore.requestTimelineSave({ immediate: true });
      },
    });

    const currentSpeedRaw = (item as any).speed;
    const currentSpeed =
      typeof currentSpeedRaw === 'number' && Number.isFinite(currentSpeedRaw)
        ? currentSpeedRaw
        : 1;

    mainGroup.push({
      label: `${t('granVideoEditor.timeline.speed', 'Speed')} (${currentSpeed.toFixed(2)})`,
      icon: 'i-heroicons-forward',
      onSelect: () => openSpeedModal(track.id, item.id, currentSpeed),
    });

    const canExtract =
      track.kind === 'video' && item.clipType === 'media' && !item.audioFromVideoDisabled;
    if (canExtract) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
        icon: 'i-heroicons-musical-note',
        onSelect: () =>
          emit('clipAction', { action: 'extractAudio', trackId: track.id, itemId: item.id }),
      });
    }

    const hasReturnFromVideoClip =
      track.kind === 'video' &&
      Boolean(item.audioFromVideoDisabled) &&
      (timelineStore.timelineDoc?.tracks ?? []).some((t: any) =>
        t.kind !== 'audio'
          ? false
          : (t.items ?? []).some(
              (it: any) =>
                it.kind === 'clip' &&
                it.linkedVideoClipId === item.id &&
                Boolean(it.lockToLinkedVideo),
            ),
      );

    const hasReturnFromLockedAudioClip =
      track.kind === 'audio' && Boolean(item.linkedVideoClipId) && Boolean(item.lockToLinkedVideo);

    if (hasReturnFromVideoClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', { action: 'returnAudio', trackId: track.id, itemId: item.id }),
      });
    } else if (hasReturnFromLockedAudioClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', {
            action: 'returnAudio',
            trackId: track.id,
            itemId: item.id,
            videoItemId: String(item.linkedVideoClipId),
          }),
      });
    }

    const isMediaVideoClip = track.kind === 'video' && item.clipType === 'media';
    const hasFreezeFrame = typeof item.freezeFrameSourceUs === 'number';
    if (isMediaVideoClip && !hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.freezeFrame', 'Freeze frame'),
        icon: 'i-heroicons-pause-circle',
        onSelect: () =>
          emit('clipAction', { action: 'freezeFrame', trackId: track.id, itemId: item.id }),
      });
    }

    if (isMediaVideoClip && hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.resetFreezeFrame', 'Reset freeze frame'),
        icon: 'i-heroicons-play-circle',
        onSelect: () =>
          emit('clipAction', { action: 'resetFreezeFrame', trackId: track.id, itemId: item.id }),
      });
    }
  }

  const actionGroup: any[] = [
    {
      label: t('granVideoEditor.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      disabled: item.kind === 'clip' && Boolean(item.locked),
      onSelect: () => {
        timelineStore.applyTimeline({
          type: 'delete_items',
          trackId: track.id,
          itemIds: [item.id],
        });
      },
    },
  ];

  const result = [];
  if (mainGroup.length > 0) result.push(mainGroup);

  if (item.kind === 'clip' && track.kind === 'video') {
    const transitionGroup: any[] = [];
    const hasIn = Boolean((item as any).transitionIn);
    const hasOut = Boolean((item as any).transitionOut);

    const defaultTransitionDurationUs = Math.max(
      0,
      Math.round(Number(projectStore.projectSettings?.transitions?.defaultDurationUs ?? 2_000_000)),
    );
    const clipDurationUs = Math.max(0, Math.round(Number(item.timelineRange?.durationUs ?? 0)));
    const suggestedDurationUs =
      clipDurationUs > 0 && clipDurationUs < defaultTransitionDurationUs
        ? Math.round(clipDurationUs * 0.3)
        : defaultTransitionDurationUs;

    transitionGroup.push({
      label: hasIn
        ? t('granVideoEditor.timeline.removeTransitionIn')
        : t('granVideoEditor.timeline.addTransitionIn'),
      icon: hasIn ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-left-end-on-rectangle',
      onSelect: () => {
        if (hasIn) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: null });
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'in' });
        }
      },
    });

    transitionGroup.push({
      label: hasOut
        ? t('granVideoEditor.timeline.removeTransitionOut')
        : t('granVideoEditor.timeline.addTransitionOut'),
      icon: hasOut ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-right-end-on-rectangle',
      onSelect: () => {
        if (hasOut) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: null });
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'out' });
        }
      },
    });

    if (transitionGroup.length > 0) result.push(transitionGroup);
  }

  result.push(actionGroup);

  return result;
}

function getTransitionForPanel() {
  if (!openTransitionPanel.value) return undefined;
  const track = props.tracks.find((t) => t.id === openTransitionPanel.value!.trackId);
  const item = track?.items.find((i) => i.id === openTransitionPanel.value!.itemId);
  if (!item || item.kind !== 'clip') return undefined;
  return openTransitionPanel.value!.edge === 'in'
    ? (item as TimelineClipItem).transitionIn
    : (item as TimelineClipItem).transitionOut;
}
</script>

<template>
  <div
    class="flex flex-col divide-y divide-ui-border"
    @mousedown="
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
    "
  >
    <AppModal
      v-model:open="speedModalOpen"
      :title="t('granVideoEditor.timeline.speedModalTitle', 'Clip speed')"
      :description="t('granVideoEditor.timeline.speedModalDescription', 'Changes clip playback speed')"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm text-ui-text">
            {{ t('granVideoEditor.timeline.speedValue', 'Speed') }}
          </span>
          <span class="text-sm font-mono text-ui-text-muted">{{ Number(speedModalSpeed).toFixed(2) }}</span>
        </div>

        <UInput
          v-model.number="speedModalSpeed"
          type="number"
          :min="0.1"
          :max="10"
          :step="0.05"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="speedModal && (speedModal.open = false)"
          >
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" @click="saveSpeedModal">
            {{ t('common.save', 'Save') }}
          </UButton>
        </div>
      </template>
    </AppModal>

    <div
      v-for="track in tracks"
      :key="track.id"
      :data-track-id="track.id"
      class="flex items-center px-2 relative"
      :class="timelineStore.selectedTrackId === track.id ? 'bg-ui-bg-elevated' : ''"
      :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
      @dragover.prevent="emit('dragover', $event, track.id)"
      @dragleave.prevent="emit('dragleave', $event, track.id)"
      @drop.prevent="emit('drop', $event, track.id)"
    >
      <div
        v-if="dragPreview && dragPreview.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-[color:var(--clip-text)] z-30 pointer-events-none opacity-80"
        :class="
          dragPreview.kind === 'file'
            ? 'bg-primary-600 border border-primary-400'
            : 'bg-ui-bg-accent border border-ui-border'
        "
        :style="{
          left: `${2 + timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(30, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
      </div>

      <div
        v-if="movePreviewResolved && movePreviewResolved.trackId === track.id"
        class="absolute inset-y-0 rounded px-2 flex items-center text-xs text-[color:var(--clip-text)] z-40 pointer-events-none opacity-60 bg-ui-bg-accent border border-ui-border"
        :style="{
          left: `${2 + timeUsToPx(movePreviewResolved.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(30, timeUsToPx(movePreviewResolved.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="movePreviewResolved.label">{{ movePreviewResolved.label }}</span>
      </div>

      <UContextMenu
        v-for="item in track.items"
        :key="item.id"
        :items="getClipContextMenuItems(track, item)"
      >
        <div
          class="absolute inset-y-0 rounded flex flex-col text-xs text-[color:var(--clip-text)] z-10 cursor-pointer select-none transition-shadow group/clip"
          :class="[
            timelineStore.selectedItemIds.includes(item.id)
              ? 'ring-2 ring-(--selection-ring) z-20 shadow-lg'
              : '',
            item.kind === 'clip' && typeof (item as any).freezeFrameSourceUs === 'number'
              ? 'outline outline-2 outline-[color:var(--color-warning)]'
              : '',
            item.kind === 'clip' && Boolean((item as any).disabled) ? 'opacity-40' : '',
            item.kind === 'clip' && Boolean((item as any).locked) ? 'cursor-not-allowed' : '',
            ...getClipClass(item, track),
          ]"
          :style="{
            left: `${2 + timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
            width: `${Math.max(30, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
          }"
          @mousedown="
            item.kind === 'clip' &&
            !Boolean((item as any).locked) &&
            emit('startMoveItem', $event, item.trackId, item.id, item.timelineRange.startUs)
          "
          @pointerdown.stop="emit('selectItem', $event, item.id)"
        >
          <!-- Audio Fade Layer (Triangles below transitions/title) -->
          <div v-if="item.kind === 'clip' && timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom) >= 60" class="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded">
            <svg
              v-if="(item as any).audioFadeInUs > 0 && (item as any).audioFadeInUs < item.timelineRange.durationUs"
              class="absolute left-0 top-0 h-full"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
              :style="{
                width: `${Math.min(
                  Math.max(
                    0,
                    timeUsToPx(Math.max(0, Math.round(Number((item as any).audioFadeInUs) || 0)), timelineStore.timelineZoom),
                  ),
                  Math.max(0, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom)),
                )}px`,
              }"
            >
              <polygon points="0,0 100,0 0,100" :fill="getClipLowerTriColor(item, track)" />
            </svg>

            <svg
              v-if="(item as any).audioFadeOutUs > 0 && (item as any).audioFadeOutUs < item.timelineRange.durationUs"
              class="absolute right-0 top-0 h-full"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
              :style="{
                width: `${Math.min(
                  Math.max(
                    0,
                    timeUsToPx(Math.max(0, Math.round(Number((item as any).audioFadeOutUs) || 0)), timelineStore.timelineZoom),
                  ),
                  Math.max(0, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom)),
                )}px`,
              }"
            >
              <polygon points="0,0 100,0 100,100" :fill="getClipLowerTriColor(item, track)" />
            </svg>
          </div>

          <!-- Fade Handles -->
          <template v-if="item.kind === 'clip' && !Boolean((item as any).locked) && timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom) >= 60">
            <!-- Fade In Handle -->
            <div
              v-if="(item as any).audioFadeInUs < item.timelineRange.durationUs"
              class="absolute top-0 w-6 h-6 -ml-3 -translate-y-1/2 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 transition-opacity z-60 flex items-center justify-center"
              :style="{ left: `${Math.min(Math.max(0, timeUsToPx((item as any).audioFadeInUs || 0, timelineStore.timelineZoom)), timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px` }"
              @mousedown.stop="startResizeFade($event, track.id, item.id, 'in', (item as any).audioFadeInUs || 0)"
            >
              <div class="w-2.5 h-2.5 rounded-full bg-white shadow-sm border border-black/30"></div>
            </div>
            
            <!-- Fade Out Handle -->
            <div
              v-if="(item as any).audioFadeOutUs < item.timelineRange.durationUs"
              class="absolute top-0 w-6 h-6 -mr-3 -translate-y-1/2 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 transition-opacity z-60 flex items-center justify-center"
              :style="{ right: `${Math.min(Math.max(0, timeUsToPx((item as any).audioFadeOutUs || 0, timelineStore.timelineZoom)), timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px` }"
              @mousedown.stop="startResizeFade($event, track.id, item.id, 'out', (item as any).audioFadeOutUs || 0)"
            >
              <div class="w-2.5 h-2.5 rounded-full bg-white shadow-sm border border-black/30"></div>
            </div>
          </template>

          <!-- Collapsed Indicators for Small Clips -->
          <div
            v-if="item.kind === 'clip' && timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom) < 60 && timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom) >= 20"
            class="absolute top-0.5 left-0.5 flex flex-col gap-0.5 z-40 pointer-events-none"
          >
            <div v-if="(item as any).audioFadeInUs > 0" class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm" title="Fade In">
              <UIcon name="i-heroicons-arrow-right" class="w-2.5 h-2.5 text-gray-800" />
            </div>
            <div v-if="(item as any).audioFadeOutUs > 0" class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm" title="Fade Out">
              <UIcon name="i-heroicons-arrow-left" class="w-2.5 h-2.5 text-gray-800" />
            </div>
          </div>

          <!-- Volume Control Line -->
          <div
            v-if="item.kind === 'clip' && ((item as any).clipType === 'media' || (item as any).clipType === 'timeline') && !(track.kind === 'video' && (item as any).audioFromVideoDisabled)"
            class="absolute left-0 right-0 z-45 h-3 -mt-1.5 flex flex-col justify-center"
            :class="[
              !Boolean((item as any).locked) ? 'cursor-ns-resize' : '',
              ((item as any).audioGain !== undefined && Math.abs((item as any).audioGain - 1) > 0.001)
                ? 'opacity-100' 
                : (timelineStore.selectedItemIds.includes(item.id) ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100')
            ]"
            :style="{
              top: `${100 - (((item as any).audioGain ?? 1) / 2) * 100}%`,
            }"
            @mousedown.stop="
              !Boolean((item as any).locked) &&
              startResizeVolume($event, track.id, item.id, (item as any).audioGain ?? 1, trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT)
            "
          >
            <div class="w-full h-[1.5px] bg-yellow-400 pointer-events-none opacity-80 group-hover/clip:opacity-100"></div>
            
            <div 
              class="absolute left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 leading-none py-0.5 bg-black/60 px-1 rounded pointer-events-none select-none transition-opacity"
              :class="[
                resizeVolume?.itemId === item.id ? 'opacity-100 z-50' : 'opacity-0 group-hover/clip:opacity-100',
                (((item as any).audioGain ?? 1) > 1) ? 'top-full mt-0.5' : 'bottom-full mb-0.5'
              ]"
            >
              {{ Math.round(((item as any).audioGain ?? 1) * 100) }}%
            </div>
          </div>

          <!-- Speed Indicator -->
          <div
            v-if="item.kind === 'clip' && Math.abs(((item as any).speed ?? 1) - 1) > 0.0001"
            class="absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-(--overlay-bg) text-[10px] leading-none font-mono z-40"
          >
            x{{ Number((item as any).speed ?? 1).toFixed(2) }}
          </div>

          <!-- Main Content (3-column layout) -->
          <div class="flex-1 flex w-full min-h-0 relative z-20">
            <!-- Left: Transition In Column -->
            <div
              v-if="item.kind === 'clip'"
              class="h-full relative transition-colors"
              :style="{ width: `${transitionUsToPx((item as any).transitionIn?.durationUs || 0)}px` }"
            >
              <template v-if="(item as any).transitionIn">
                <button
                  type="button"
                  class="w-full h-full overflow-hidden group"
                  :class="[
                    selectedTransition?.itemId === item.id &&
                    selectedTransition?.trackId === item.trackId &&
                    selectedTransition?.edge === 'in'
                      ? 'ring-2 ring-inset ring-amber-300 z-10'
                      : hasTransitionInProblem(track, item)
                        ? 'ring-2 ring-inset ring-orange-500 z-10'
                        : '',
                  ]"
                  :title="
                    hasTransitionInProblem(track, item) ??
                    `Transition In: ${(item as any).transitionIn?.type}`
                  "
                  @click.stop="selectTransition($event, { trackId: item.trackId, itemId: item.id, edge: 'in' })"
                  @pointerdown.stop
                  @mousedown.stop
                  @dblclick.stop="
                    openTransitionPanel = {
                      trackId: item.trackId,
                      itemId: item.id,
                      edge: 'in',
                      anchorEl: $event.currentTarget as HTMLElement,
                    }
                  "
                >
                  <template v-if="!isCrossfadeTransitionIn(track, item as TimelineClipItem)">
                    <svg
                      v-if="((item as any).transitionIn?.mode ?? 'blend') === 'blend'"
                      class="w-full h-full block"
                      preserveAspectRatio="none"
                      viewBox="0 0 100 100"
                    >
                      <path
                        :d="transitionSvgParts(100, 100, 'in')"
                        :fill="getClipLowerTriColor(item, track)"
                      />
                    </svg>
                    <template v-else>
                      <div class="absolute inset-0 bg-linear-to-r from-transparent to-white/20" />
                      <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
                    </template>
                  </template>
                  <!-- Problem indicator -->
                  <div
                    v-if="hasTransitionInProblem(track, item)"
                    class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-500 pointer-events-none z-20"
                  />
                  <!-- Resize handle inside transition block -->
                  <div
                    v-if="!Boolean((item as any).locked)"
                    class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/20 hover:bg-white/40! transition-colors z-40"
                    @mousedown.stop="
                      startResizeTransition(
                        $event,
                        item.trackId,
                        item.id,
                        'in',
                        (item as any).transitionIn?.durationUs ?? 500_000,
                      )
                    "
                  />
                </button>
              </template>
            </div>

            <!-- Middle: Title Block -->
          <div class="flex-1 flex items-end justify-center px-1 min-w-0">
            <span class="truncate" :title="item.kind === 'clip' ? item.name : ''">
              {{ item.kind === 'clip' ? item.name : '' }}
            </span>
          </div>

            <!-- Right: Transition Out Column -->
            <div
              v-if="item.kind === 'clip'"
              class="h-full relative transition-colors"
              :style="{ width: `${transitionUsToPx((item as any).transitionOut?.durationUs || 0)}px` }"
            >
              <template v-if="(item as any).transitionOut">
                <button
                  type="button"
                  class="w-full h-full overflow-hidden group"
                  :class="[
                    selectedTransition?.itemId === item.id &&
                    selectedTransition?.trackId === item.trackId &&
                    selectedTransition?.edge === 'out'
                      ? 'ring-2 ring-inset ring-amber-300 z-10'
                      : hasTransitionOutProblem(track, item)
                        ? 'ring-2 ring-inset ring-orange-500 z-10'
                        : '',
                  ]"
                  :title="
                    hasTransitionOutProblem(track, item) ??
                    `Transition Out: ${(item as any).transitionOut?.type}`
                  "
                  @click.stop="selectTransition($event, { trackId: item.trackId, itemId: item.id, edge: 'out' })"
                  @pointerdown.stop
                  @mousedown.stop
                  @dblclick.stop="
                    openTransitionPanel = {
                      trackId: item.trackId,
                      itemId: item.id,
                      edge: 'out',
                      anchorEl: $event.currentTarget as HTMLElement,
                    }
                  "
                >
                  <svg
                    v-if="((item as any).transitionOut?.mode ?? 'blend') === 'blend'"
                    class="w-full h-full block"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 100"
                  >
                    <path
                      :d="transitionSvgParts(100, 100, 'out')"
                      :fill="getClipLowerTriColor(item, track)"
                    />
                  </svg>
                  <template v-else>
                    <div class="absolute inset-0 bg-linear-to-l from-transparent to-white/20" />
                    <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
                  </template>
                  <!-- Problem indicator -->
                  <div
                    v-if="hasTransitionOutProblem(track, item)"
                    class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-500 pointer-events-none z-20"
                  />
                  <!-- Resize handle inside transition block -->
                   <div
                    v-if="!Boolean((item as any).locked)"
                    class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/20 hover:bg-white/40! transition-colors z-40"
                    @mousedown.stop="
                      startResizeTransition(
                        $event,
                        item.trackId,
                        item.id,
                        'out',
                        (item as any).transitionOut?.durationUs ?? 500_000,
                      )
                    "
                  />
                </button>
              </template>
            </div>
          </div>

          <!-- Trim Handles (On top of everything, transparent by default) -->
          <div
            v-if="item.kind === 'clip' && !Boolean((item as any).locked)"
            class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group"
            @mousedown.stop="
              emit('startTrimItem', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'start',
                startUs: item.timelineRange.startUs,
              })
            "
          />
          <div
            v-if="item.kind === 'clip' && !Boolean((item as any).locked)"
            class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group"
            @mousedown.stop="
              emit('startTrimItem', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'end',
                startUs: item.timelineRange.startUs,
              })
            "
          />
        </div>
      </UContextMenu>
    </div>
  </div>

  <!-- Transition panel popup (double-click to open, click outside to close) -->
  <div
    v-if="openTransitionPanel"
    class="fixed inset-0 z-50"
    @mousedown.self="openTransitionPanel = null"
  >
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-xl">
      <ClipTransitionPanel
        :edge="openTransitionPanel.edge"
        :track-id="openTransitionPanel.trackId"
        :item-id="openTransitionPanel.itemId"
        :transition="getTransitionForPanel()"
        @update="handleTransitionUpdate"
      />
    </div>
  </div>
</template>
