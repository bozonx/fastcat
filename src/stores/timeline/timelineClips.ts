import type { Ref } from 'vue';
import type {
  TimelineDocument,
  TimelineClipItem,
  ClipTransition,
  TextClipStyle,
  TimelineClipType,
  TimelineTrack,
} from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { getDocFps, quantizeTimeUsToFrames } from '~/timeline/commands/utils';

export interface TimelineClipsDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  selectedItemIds: Ref<string[]>;
  selectedTrackId: Ref<string | null>;
  selectedTransition: Ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>;
  currentTime: Ref<number>;
  applyTimeline: (
    cmd: TimelineCommand,
    options?: { historyMode?: 'immediate' | 'debounced' },
  ) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  resolveTargetVideoTrackIdForInsert: () => string;
  clearSelection: () => void;
  clearSelectedTransition: () => void;
  rippleDeleteRange: (input: { trackIds: string[]; startUs: number; endUs: number }) => void;
  createFallbackTimelineDoc: () => TimelineDocument;
  deleteTrack: (trackId: string, options?: { allowNonEmpty?: boolean }) => void;
  selectTrack: (trackId: string | null) => void;
  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
}

export interface TimelineClipsApi {
  renameItem: (trackId: string, itemId: string, name: string) => void;
  updateClipProperties: (
    trackId: string,
    itemId: string,
    properties: Partial<
      Pick<
        TimelineClipItem,
        | 'disabled'
        | 'locked'
        | 'opacity'
        | 'effects'
        | 'freezeFrameSourceUs'
        | 'speed'
        | 'transform'
        | 'audioGain'
        | 'audioBalance'
        | 'audioFadeInUs'
        | 'audioFadeOutUs'
      >
    > & {
      backgroundColor?: string;
      text?: string;
      style?: TextClipStyle;
    },
  ) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    options: {
      transitionIn?: ClipTransition | null;
      transitionOut?: ClipTransition | null;
    },
  ) => void;
  deleteSelectedItems: (trackId: string) => void;
  deleteFirstSelectedItem: () => void;
  rippleDeleteFirstSelectedItem: () => void;
  addVirtualClipAtPlayhead: (input: {
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
  }) => void;
  addVirtualClipToTrack: (input: {
    trackId: string;
    startUs: number;
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
  }) => void;
  addAdjustmentClipAtPlayhead: (options?: { durationUs?: number; name?: string }) => void;
  addBackgroundClipAtPlayhead: (options?: {
    durationUs?: number;
    name?: string;
    backgroundColor?: string;
  }) => void;
  addTextClipAtPlayhead: (options?: {
    durationUs?: number;
    name?: string;
    text?: string;
    style?: TextClipStyle;
  }) => void;
  setClipFreezeFrameFromPlayhead: (input: { trackId: string; itemId: string }) => void;
  resetClipFreezeFrame: (input: { trackId: string; itemId: string }) => void;
  toggleDisableTargetClip: () => Promise<void>;
  toggleMuteTargetClip: () => Promise<void>;
}

export function createTimelineClips(deps: TimelineClipsDeps): TimelineClipsApi {
  function renameItem(trackId: string, itemId: string, name: string) {
    deps.applyTimeline({
      type: 'rename_item',
      trackId,
      itemId,
      name,
    });
  }

  function updateClipProperties(
    trackId: string,
    itemId: string,
    properties: Partial<
      Pick<
        TimelineClipItem,
        | 'disabled'
        | 'locked'
        | 'opacity'
        | 'effects'
        | 'freezeFrameSourceUs'
        | 'speed'
        | 'transform'
        | 'audioGain'
        | 'audioBalance'
        | 'audioFadeInUs'
        | 'audioFadeOutUs'
        | 'audioMuted'
      >
    > & {
      backgroundColor?: string;
      text?: string;
      style?: TextClipStyle;
    },
  ) {
    deps.applyTimeline(
      {
        type: 'update_clip_properties',
        trackId,
        itemId,
        properties,
      },
      { historyMode: 'debounced' },
    );
  }

  function updateClipTransition(
    trackId: string,
    itemId: string,
    options: {
      transitionIn?: ClipTransition | null;
      transitionOut?: ClipTransition | null;
    },
  ) {
    deps.applyTimeline({
      type: 'update_clip_transition',
      trackId,
      itemId,
      ...options,
    });
  }

  function deleteSelectedItems(trackId: string) {
    if (deps.selectedItemIds.value.length === 0) return;
    deps.applyTimeline({
      type: 'delete_items',
      trackId,
      itemIds: [...deps.selectedItemIds.value],
    });
    deps.selectedItemIds.value = [];
  }

  function deleteFirstSelectedItem() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    if (deps.selectedTransition.value) {
      updateClipTransition(
        deps.selectedTransition.value.trackId,
        deps.selectedTransition.value.itemId,
        deps.selectedTransition.value.edge === 'in'
          ? { transitionIn: null }
          : { transitionOut: null },
      );
      deps.clearSelectedTransition();
      return;
    }

    if (deps.selectedItemIds.value.length === 0) {
      if (deps.selectedTrackId.value) {
        deps.deleteTrack(deps.selectedTrackId.value, { allowNonEmpty: true });
        deps.selectTrack(null);
      }
      return;
    }

    const selectedSet = new Set(deps.selectedItemIds.value);
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (selectedSet.has(item.id)) {
          deleteSelectedItems(track.id);
          return;
        }
      }
    }
  }

  function rippleDeleteFirstSelectedItem() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    if (deps.selectedItemIds.value.length === 0) return;

    const selectedSet = new Set(deps.selectedItemIds.value);
    let targetTrack: TimelineTrack | null = null;
    const targetItems: TimelineClipItem[] = [];

    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (selectedSet.has(item.id)) {
          targetTrack = track;
          break;
        }
      }
      if (targetTrack) break;
    }

    if (!targetTrack) return;
    for (const item of targetTrack.items) {
      if (selectedSet.has(item.id) && item.kind === 'clip') {
        targetItems.push(item);
      }
    }

    if (targetItems.length === 0) return;

    let startUs = Infinity;
    let endUs = -Infinity;
    for (const item of targetItems) {
      startUs = Math.min(startUs, item.timelineRange.startUs);
      endUs = Math.max(endUs, item.timelineRange.startUs + item.timelineRange.durationUs);
    }

    if (startUs < endUs) {
      deps.rippleDeleteRange({ trackIds: [targetTrack.id], startUs, endUs });
      deps.clearSelection();
    }
  }

  function addVirtualClipAtPlayhead(input: {
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
  }) {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const trackId = deps.resolveTargetVideoTrackIdForInsert();
    deps.applyTimeline({
      type: 'add_virtual_clip_to_track',
      trackId,
      clipType: input.clipType,
      name: input.name,
      durationUs: input.durationUs,
      backgroundColor: input.backgroundColor,
      text: input.text,
      style: input.style,
      startUs: deps.currentTime.value,
    });
  }

  function addVirtualClipToTrack(input: {
    trackId: string;
    startUs: number;
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
  }) {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    deps.applyTimeline({
      type: 'add_virtual_clip_to_track',
      trackId: input.trackId,
      clipType: input.clipType,
      name: input.name,
      durationUs: input.durationUs,
      backgroundColor: input.backgroundColor,
      text: input.text,
      style: input.style,
      startUs: input.startUs,
    });
  }

  function addAdjustmentClipAtPlayhead(options?: { durationUs?: number; name?: string }) {
    addVirtualClipAtPlayhead({
      clipType: 'adjustment',
      name: options?.name ?? 'Adjustment',
      durationUs: options?.durationUs,
    });
  }

  function addBackgroundClipAtPlayhead(options?: {
    durationUs?: number;
    name?: string;
    backgroundColor?: string;
  }) {
    addVirtualClipAtPlayhead({
      clipType: 'background',
      name: options?.name ?? 'Background',
      durationUs: options?.durationUs,
      backgroundColor: options?.backgroundColor,
    });
  }

  function addTextClipAtPlayhead(options?: {
    durationUs?: number;
    name?: string;
    text?: string;
    style?: TextClipStyle;
  }) {
    addVirtualClipAtPlayhead({
      clipType: 'text',
      name: options?.name ?? 'Text',
      durationUs: options?.durationUs,
      text: options?.text,
      style: options?.style,
    });
  }

  function setClipFreezeFrameFromPlayhead(input: { trackId: string; itemId: string }) {
    const doc = deps.timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');

    const track = doc.tracks.find((t) => t.id === input.trackId) ?? null;
    if (!track) throw new Error('Track not found');

    const item = track.items.find((it) => it.id === input.itemId);
    if (!item || item.kind !== 'clip') throw new Error('Clip not found');
    if (item.clipType !== 'media') throw new Error('Only media clips can freeze frame');

    const fps = getDocFps(doc);

    const clipStartUs = item.timelineRange.startUs;
    const clipEndUs = clipStartUs + item.timelineRange.durationUs;
    const playheadUs = deps.currentTime.value;

    const usePlayhead = playheadUs >= clipStartUs && playheadUs < clipEndUs;
    const localUs = usePlayhead ? playheadUs - clipStartUs : 0;
    const sourceUsRaw = item.sourceRange.startUs + localUs;
    const sourceUs = quantizeTimeUsToFrames(sourceUsRaw, fps, 'round');

    updateClipProperties(input.trackId, input.itemId, { freezeFrameSourceUs: sourceUs });
  }

  function resetClipFreezeFrame(input: { trackId: string; itemId: string }) {
    updateClipProperties(input.trackId, input.itemId, { freezeFrameSourceUs: undefined });
  }

  async function toggleDisableTargetClip() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    updateClipProperties(target.trackId, target.itemId, { disabled: !item.disabled });
    await deps.requestTimelineSave({ immediate: true });
  }

  async function toggleMuteTargetClip() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    updateClipProperties(target.trackId, target.itemId, { audioMuted: !item.audioMuted });
    await deps.requestTimelineSave({ immediate: true });
  }

  return {
    renameItem,
    updateClipProperties,
    updateClipTransition,
    deleteSelectedItems,
    deleteFirstSelectedItem,
    rippleDeleteFirstSelectedItem,
    addVirtualClipAtPlayhead,
    addVirtualClipToTrack,
    addAdjustmentClipAtPlayhead,
    addBackgroundClipAtPlayhead,
    addTextClipAtPlayhead,
    setClipFreezeFrameFromPlayhead,
    resetClipFreezeFrame,
    toggleDisableTargetClip,
    toggleMuteTargetClip,
  };
}
