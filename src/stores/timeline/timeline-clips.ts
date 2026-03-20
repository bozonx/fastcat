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
import { CLIP_AUDIO_GAIN_MAX } from '~/utils/audio/envelope';

export interface TimelineClipClipboardItem {
  sourceTrackId: string;
  clip: TimelineClipItem;
}

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
  defaultStaticClipDurationUs: number;
  defaultAudioFadeCurve: import('~/timeline/types').AudioFadeCurve;
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
        | 'blendMode'
        | 'effects'
        | 'freezeFrameSourceUs'
        | 'speed'
        | 'transform'
        | 'audioGain'
        | 'audioBalance'
        | 'audioFadeInUs'
        | 'audioFadeOutUs'
        | 'audioFadeInCurve'
        | 'audioFadeOutCurve'
        | 'audioMuted'
        | 'audioWaveformMode'
        | 'showWaveform'
        | 'showThumbnails'
      >
    > & {
      backgroundColor?: string;
      text?: string;
      style?: TextClipStyle;
      shapeType?: import('~/timeline/types').ShapeType;
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      hudType?: import('~/timeline/types').HudType;
      background?: import('~/timeline/types').HudMediaParams;
      content?: import('~/timeline/types').HudMediaParams;
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
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text' | 'shape' | 'hud'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
    shapeType?: import('~/timeline/types').ShapeType;
    hudType?: import('~/timeline/types').HudType;
  }) => void;
  addVirtualClipToTrack: (
    input: {
      trackId: string;
      startUs: number;
      clipType: Extract<
        import('~/timeline/types').TimelineClipType,
        'adjustment' | 'background' | 'text' | 'shape' | 'hud'
      >;
      name: string;
      durationUs?: number;
      backgroundColor?: string;
      text?: string;
      style?: import('~/timeline/types').TextClipStyle;
      shapeType?: import('~/timeline/types').ShapeType;
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      shapeConfig?: import('~/timeline/types').ShapeConfig;
      hudType?: import('~/timeline/types').HudType;
      background?: import('~/timeline/types').HudMediaParams;
      content?: import('~/timeline/types').HudMediaParams;
      pseudo?: boolean;
    },
    options?: {
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) => void;
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
  moveSelectedClips: (deltaFrames: number) => void;
  adjustSelectedClipsVolume: (deltaDb: number) => void;
  copySelectedClips: () => TimelineClipClipboardItem[];
  cutSelectedClips: () => TimelineClipClipboardItem[];
  pasteClips: (
    items: TimelineClipClipboardItem[],
    options?: { targetTrackId?: string | null; insertStartUs?: number },
  ) => string[];
}

export function createTimelineClips(deps: TimelineClipsDeps): TimelineClipsApi {
  function cloneClip<T>(value: T): T {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function getSelectedClipItems(): TimelineClipClipboardItem[] {
    const doc = deps.timelineDoc.value;
    if (!doc || deps.selectedItemIds.value.length === 0) return [];

    const selectedIds = new Set(deps.selectedItemIds.value);
    const items: TimelineClipClipboardItem[] = [];

    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (!selectedIds.has(item.id)) continue;
        items.push({
          sourceTrackId: track.id,
          clip: cloneClip(item),
        });
      }
    }

    items.sort((a, b) => a.clip.timelineRange.startUs - b.clip.timelineRange.startUs);
    return items;
  }

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
        | 'blendMode'
        | 'effects'
        | 'freezeFrameSourceUs'
        | 'speed'
        | 'transform'
        | 'audioGain'
        | 'audioBalance'
        | 'audioFadeInUs'
        | 'audioFadeOutUs'
        | 'audioFadeInCurve'
        | 'audioFadeOutCurve'
        | 'audioMuted'
        | 'audioWaveformMode'
        | 'showWaveform'
        | 'showThumbnails'
        | 'linkedVideoClipId'
        | 'lockToLinkedVideo'
        | 'linkedGroupId'
      >
    > & {
      backgroundColor?: string;
      text?: string;
      style?: TextClipStyle;
      shapeType?: import('~/timeline/types').ShapeType;
      fillColor?: string;
      strokeColor?: string;
      strokeWidth?: number;
      shapeConfig?: import('~/timeline/types').ShapeConfig;
      hudType?: import('~/timeline/types').HudType;
      background?: import('~/timeline/types').HudMediaParams;
      content?: import('~/timeline/types').HudMediaParams;
    },
  ) {
    const validatedProperties = { ...properties };

    if (typeof validatedProperties.opacity === 'number') {
      validatedProperties.opacity = Math.max(0, Math.min(1, validatedProperties.opacity));
    }

    if (typeof validatedProperties.audioGain === 'number') {
      validatedProperties.audioGain = Math.max(
        0,
        Math.min(CLIP_AUDIO_GAIN_MAX, validatedProperties.audioGain),
      );
    }

    if (typeof validatedProperties.audioBalance === 'number') {
      validatedProperties.audioBalance = Math.max(
        -1,
        Math.min(1, validatedProperties.audioBalance),
      );
    }

    if (validatedProperties.blendMode) {
      const validBlendModes = ['normal', 'add', 'multiply', 'screen', 'darken', 'lighten'];
      if (!validBlendModes.includes(validatedProperties.blendMode as string)) {
        validatedProperties.blendMode = 'normal';
      }
    }

    deps.applyTimeline(
      {
        type: 'update_clip_properties',
        trackId,
        itemId,
        properties: validatedProperties,
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

  function copySelectedClips(): TimelineClipClipboardItem[] {
    return getSelectedClipItems();
  }

  function cutSelectedClips(): TimelineClipClipboardItem[] {
    const items = getSelectedClipItems();
    if (items.length === 0) return [];

    const byTrack = new Map<string, string[]>();
    for (const item of items) {
      const current = byTrack.get(item.sourceTrackId) ?? [];
      current.push(item.clip.id);
      byTrack.set(item.sourceTrackId, current);
    }

    for (const [trackId, itemIds] of byTrack.entries()) {
      deps.applyTimeline({
        type: 'delete_items',
        trackId,
        itemIds,
      });
    }

    deps.clearSelection();
    deps.selectTrack(null);
    return items;
  }

  function pasteClips(
    items: TimelineClipClipboardItem[],
    options?: { targetTrackId?: string | null; insertStartUs?: number },
  ): string[] {
    if (items.length === 0) return [];

    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const doc = deps.timelineDoc.value;
    if (!doc) return [];

    const targetTrackId = options?.targetTrackId ?? deps.resolveTargetVideoTrackIdForInsert();
    const targetTrack = doc.tracks.find((track) => track.id === targetTrackId) ?? null;
    if (!targetTrack) return [];

    const minStartUs = Math.min(...items.map((item) => item.clip.timelineRange.startUs));
    const insertStartUs = Math.max(0, Math.round(options?.insertStartUs ?? deps.currentTime.value));
    const createdIds: string[] = [];

    for (const item of items) {
      const clip = cloneClip(item.clip);
      const relativeStartUs = clip.timelineRange.startUs - minStartUs;
      const nextStartUs = insertStartUs + relativeStartUs;

      if ((clip.clipType === 'media' || clip.clipType === 'timeline') && clip.source?.path) {
        deps.applyTimeline({
          type: 'add_clip_to_track',
          trackId: clip.trackId,
          name: clip.name,
          path: clip.source.path,
          startUs: clip.timelineRange.startUs,
          durationUs: clip.timelineRange.durationUs,
          sourceRange: clip.sourceRange,
          isImage: clip.isImage,
        });
        continue;
      }

      deps.applyTimeline({
        type: 'add_virtual_clip_to_track',
        trackId: targetTrack.id,
        clipType: clip.clipType as Extract<
          TimelineClipType,
          'adjustment' | 'background' | 'text' | 'shape' | 'hud'
        >,
        name: clip.name,
        durationUs: clip.timelineRange.durationUs,
        startUs: nextStartUs,
        backgroundColor: 'backgroundColor' in clip ? clip.backgroundColor : undefined,
        text: 'text' in clip ? clip.text : undefined,
        style: 'style' in clip ? clip.style : undefined,
        shapeType: 'shapeType' in clip ? clip.shapeType : undefined,
        hudType: 'hudType' in clip ? clip.hudType : undefined,
      });

      const refreshedTrack =
        deps.timelineDoc.value?.tracks.find((track) => track.id === targetTrack.id) ?? null;
      const createdClip =
        refreshedTrack?.items.find(
          (trackItem) =>
            trackItem.kind === 'clip' &&
            trackItem.timelineRange.startUs === nextStartUs &&
            trackItem.timelineRange.durationUs === clip.timelineRange.durationUs &&
            trackItem.name === clip.name,
        ) ?? null;

      if (!createdClip || createdClip.kind !== 'clip') {
        continue;
      }

      createdIds.push(createdClip.id);

      updateClipProperties(targetTrack.id, createdClip.id, {
        disabled: clip.disabled,
        locked: clip.locked,
        opacity: clip.opacity,
        blendMode: clip.blendMode,
        effects: cloneClip(clip.effects ?? []),
        freezeFrameSourceUs: clip.freezeFrameSourceUs,
        speed: clip.speed,
        transform: cloneClip(clip.transform),
        audioGain: clip.audioGain,
        audioBalance: clip.audioBalance,
        audioFadeInUs: clip.audioFadeInUs,
        audioFadeOutUs: clip.audioFadeOutUs,
        audioFadeInCurve: clip.audioFadeInCurve,
        audioFadeOutCurve: clip.audioFadeOutCurve,
        audioMuted: clip.audioMuted,
        audioWaveformMode: clip.audioWaveformMode,
        showWaveform: clip.showWaveform,
        showThumbnails: clip.showThumbnails,
        backgroundColor: 'backgroundColor' in clip ? clip.backgroundColor : undefined,
        text: 'text' in clip ? clip.text : undefined,
        style: 'style' in clip ? cloneClip(clip.style) : undefined,
        shapeType: 'shapeType' in clip ? clip.shapeType : undefined,
        fillColor: 'fillColor' in clip ? clip.fillColor : undefined,
        strokeColor: 'strokeColor' in clip ? clip.strokeColor : undefined,
        strokeWidth: 'strokeWidth' in clip ? clip.strokeWidth : undefined,
        hudType: 'hudType' in clip ? clip.hudType : undefined,
        background: 'background' in clip ? cloneClip(clip.background) : undefined,
        content: 'content' in clip ? cloneClip(clip.content) : undefined,
      });

      updateClipTransition(targetTrack.id, createdClip.id, {
        transitionIn: cloneClip(clip.transitionIn),
        transitionOut: cloneClip(clip.transitionOut),
      });
    }

    return createdIds;
  }

  function rippleDeleteFirstSelectedItem() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    if (deps.selectedItemIds.value.length === 0) return;

    const selectedSet = new Set(deps.selectedItemIds.value);
    let targetTrack: TimelineTrack | null = null;

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

    // Collect selected items (both clips and gaps)
    let startUs = Infinity;
    let endUs = -Infinity;
    const itemIds: string[] = [];

    for (const item of targetTrack.items) {
      if (!selectedSet.has(item.id)) continue;
      itemIds.push(item.id);
      startUs = Math.min(startUs, item.timelineRange.startUs);
      endUs = Math.max(endUs, item.timelineRange.startUs + item.timelineRange.durationUs);
    }

    if (itemIds.length === 0 || startUs >= endUs) return;

    deps.rippleDeleteRange({ trackIds: [targetTrack.id], startUs, endUs });
    deps.clearSelection();
  }

  function addVirtualClipAtPlayhead(input: {
    clipType: Extract<TimelineClipType, 'adjustment' | 'background' | 'text' | 'shape' | 'hud'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: TextClipStyle;
    shapeType?: import('~/timeline/types').ShapeType;
    hudType?: import('~/timeline/types').HudType;
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
      shapeType: input.shapeType,
      hudType: input.hudType,
      startUs: deps.currentTime.value,
      audioFadeInCurve: deps.defaultAudioFadeCurve,
      audioFadeOutCurve: deps.defaultAudioFadeCurve,
    });
  }

  function addClipToTrackFromPath(
    input: {
      trackId: string;
      name: string;
      path: string;
      startUs?: number;
      pseudo?: boolean;
    },
    options?: {
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    deps.applyTimeline(
      {
        type: 'add_clip_to_track',
        trackId: input.trackId,
        name: input.name,
        path: input.path,
        startUs: input.startUs ?? 0,
        durationUs: 0,
        pseudo: input.pseudo,
      },
      options,
    );
  }

  function addVirtualClipToTrack(
    input: {
      trackId: string;
      startUs: number;
      clipType: Extract<
        import('~/timeline/types').TimelineClipType,
        'adjustment' | 'background' | 'text' | 'shape' | 'hud'
      >;
      name: string;
      durationUs?: number;
      backgroundColor?: string;
      text?: string;
      style?: import('~/timeline/types').TextClipStyle;
      shapeType?: import('~/timeline/types').ShapeType;
      hudType?: import('~/timeline/types').HudType;
      pseudo?: boolean;
    },
    options?: {
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) {
    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    deps.applyTimeline(
      {
        type: 'add_virtual_clip_to_track',
        trackId: input.trackId,
        startUs: input.startUs,
        clipType: input.clipType,
        name: input.name,
        durationUs: input.durationUs ?? deps.defaultStaticClipDurationUs,
        backgroundColor: input.backgroundColor,
        text: input.text,
        style: input.style,
        shapeType: input.shapeType,
        hudType: input.hudType,
        pseudo: input.pseudo,
        audioFadeInCurve: deps.defaultAudioFadeCurve,
        audioFadeOutCurve: deps.defaultAudioFadeCurve,
      },
      options,
    );
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

  function moveSelectedClips(deltaFrames: number) {
    const doc = deps.timelineDoc.value;
    if (!doc || deps.selectedItemIds.value.length === 0) return;

    const fps = getDocFps(doc);
    const frameUs = 1_000_000 / fps;
    const deltaUs = deltaFrames * frameUs;

    const moves: { fromTrackId: string; toTrackId: string; itemId: string; startUs: number }[] = [];

    const selectedSet = new Set(deps.selectedItemIds.value);
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;
        if (!selectedSet.has(item.id)) continue;

        moves.push({
          fromTrackId: track.id,
          toTrackId: track.id,
          itemId: item.id,
          startUs: quantizeTimeUsToFrames(item.timelineRange.startUs + deltaUs, fps, 'round'),
        });
      }
    }

    if (moves.length === 0) return;

    deps.applyTimeline({
      type: 'move_items',
      moves,
      quantizeToFrames: true,
    });
  }

  function adjustSelectedClipsVolume(deltaDb: number) {
    const doc = deps.timelineDoc.value;
    if (!doc || deps.selectedItemIds.value.length === 0) return;

    const selectedSet = new Set(deps.selectedItemIds.value);
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (selectedSet.has(item.id) && item.kind === 'clip') {
          const currentGain = item.audioGain ?? 1;
          const currentDb = 20 * Math.log10(currentGain || 0.0001);
          const nextDb = currentDb + deltaDb;
          const nextGain = Math.pow(10, nextDb / 20);

          updateClipProperties(track.id, item.id, {
            audioGain: Math.max(0, Math.min(CLIP_AUDIO_GAIN_MAX, nextGain)),
          });
        }
      }
    }
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
    moveSelectedClips,
    adjustSelectedClipsVolume,
    copySelectedClips,
    cutSelectedClips,
    pasteClips,
  };
}
