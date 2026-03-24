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
import { cloneValue } from '~/utils/clone';

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
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) => string[];
  batchApplyTimeline: (
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      labelKey?: string;
    },
  ) => string[];
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
        | 'audioFromVideoDisabled'
        | 'linkedVideoClipId'
        | 'lockToLinkedVideo'
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
        | 'sourceRange'
        | 'sourceDurationUs'
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
  ) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    options: {
      transitionIn?: ClipTransition | null;
      transitionOut?: ClipTransition | null;
    },
    applyOptions?: {
      skipHistory?: boolean;
      saveMode?: 'debounced' | 'immediate' | 'none';
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
  ) => { trackId: string; itemId: string }[];
}

export function createTimelineClips(deps: TimelineClipsDeps): TimelineClipsApi {
  function cloneClip<T>(value: T): T {
    return cloneValue(value);
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
        | 'sourceRange'
        | 'sourceDurationUs'
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
      frame?: import('~/timeline/types').HudMediaParams;
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
    applyOptions?: {
      skipHistory?: boolean;
      saveMode?: 'debounced' | 'immediate' | 'none';
    },
  ) {
    deps.applyTimeline(
      {
        type: 'update_clip_transition',
        trackId,
        itemId,
        ...options,
      },
      applyOptions,
    );
  }

  function deleteSelectedItems(trackId: string) {
    if (deps.selectedItemIds.value.length === 0) return;
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const track = doc.tracks.find((t) => t.id === trackId);
    if (!track) return;

    // Filter out locked items
    const selectedSet = new Set(deps.selectedItemIds.value);
    const itemIdsToDelete = track.items
      .filter((item) => selectedSet.has(item.id))
      .filter((item) => {
        if (track.locked) return false;
        if (item.kind === 'clip' && item.locked) return false;
        return true;
      })
      .map((item) => item.id);

    if (itemIdsToDelete.length === 0) return;

    deps.applyTimeline({
      type: 'delete_items',
      trackId,
      itemIds: itemIdsToDelete,
    });

    // Remove only deleted IDs from selection
    const deletedIdSet = new Set(itemIdsToDelete);
    deps.selectedItemIds.value = deps.selectedItemIds.value.filter((id) => !deletedIdSet.has(id));
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
      if (track.locked) continue;
      for (const item of track.items) {
        if (item.kind === 'clip' && item.locked) continue;
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
    const doc = deps.timelineDoc.value;
    if (!doc) return [];

    for (const item of items) {
      const track = doc.tracks.find((t) => t.id === item.sourceTrackId);
      if (!track || track.locked) continue;
      if (item.clip.locked) continue;

      const current = byTrack.get(item.sourceTrackId) ?? [];
      current.push(item.clip.id);
      byTrack.set(item.sourceTrackId, current);
    }

    const deleteCommands: TimelineCommand[] = [];
    for (const [trackId, itemIds] of byTrack.entries()) {
      deleteCommands.push({
        type: 'delete_items',
        trackId,
        itemIds,
      });
    }

    if (deleteCommands.length > 0) {
      deps.batchApplyTimeline(deleteCommands, {
        labelKey: 'timeline.cutItems',
      });

      // Clear selection only of cut items
      const cutIds = new Set(Array.from(byTrack.values()).flat());
      deps.selectedItemIds.value = deps.selectedItemIds.value.filter((id) => !cutIds.has(id));
    }

    return items;
  }

  function pasteClips(
    items: TimelineClipClipboardItem[],
    options?: { targetTrackId?: string | null; insertStartUs?: number },
  ): { trackId: string; itemId: string }[] {
    if (items.length === 0) return [];

    if (!deps.timelineDoc.value) {
      deps.timelineDoc.value = deps.createFallbackTimelineDoc();
    }

    const doc = deps.timelineDoc.value;
    if (!doc) return [];

    // 1. Determine the base target track
    const baseTargetTrackId = options?.targetTrackId ?? deps.resolveTargetVideoTrackIdForInsert();
    const baseTargetTrackIndex = doc.tracks.findIndex((track) => track.id === baseTargetTrackId);
    if (baseTargetTrackIndex === -1) return [];

    const baseTargetTrack = doc.tracks[baseTargetTrackIndex]!;

    // 2. Determine horizontal and vertical offsets
    const minStartUs = Math.min(...items.map((item) => item.clip.timelineRange.startUs));
    const insertStartUs = Math.max(0, Math.round(options?.insertStartUs ?? deps.currentTime.value));

    // Identify unique source tracks and find the "top-most" one among copied items
    const sourceTrackIdsSet = new Set(items.map((it) => it.sourceTrackId));
    const sourceTrackIndices = Array.from(sourceTrackIdsSet)
      .map((id) => doc.tracks.findIndex((t) => t.id === id))
      .filter((idx) => idx !== -1)
      .sort((a, b) => a - b);

    const minSourceTrackIndex =
      sourceTrackIndices.length > 0 ? (sourceTrackIndices[0] as number) : 0;

    const commands: TimelineCommand[] = [];
    const pasteDescriptor: { trackId: string; itemId: string }[] = [];

    // Map to translate old IDs to new IDs for preserving links within the pasted group
    const idMap = new Map<string, string>();

    for (const item of items) {
      const clip = item.clip;
      const targetTrack =
        doc.tracks[
          baseTargetTrackIndex +
            (doc.tracks.findIndex((t) => t.id === item.sourceTrackId) - minSourceTrackIndex)
        ] || baseTargetTrack;

      const newClipId = `clip_${targetTrack.id}_paste_${Math.random().toString(36).substring(2, 9)}`;
      idMap.set(clip.id, newClipId);
      pasteDescriptor.push({ trackId: targetTrack.id, itemId: newClipId });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const clip = cloneClip(item.clip);
      const { trackId, itemId: newClipId } = pasteDescriptor[i]!;

      const relativeStartUs = clip.timelineRange.startUs - minStartUs;
      const nextStartUs = insertStartUs + relativeStartUs;

      if ((clip.clipType === 'media' || clip.clipType === 'timeline') && clip.source?.path) {
        commands.push({
          type: 'add_clip_to_track',
          trackId,
          clipId: newClipId,
          name: clip.name,
          path: clip.source.path,
          startUs: nextStartUs,
          durationUs: clip.timelineRange.durationUs,
          sourceDurationUs: clip.sourceDurationUs,
          sourceRange: clip.sourceRange,
          isImage: clip.isImage,
          pseudo: true,
        });
      } else {
        commands.push({
          type: 'add_virtual_clip_to_track',
          trackId,
          clipType: clip.clipType as any,
          name: clip.name,
          durationUs: clip.timelineRange.durationUs,
          startUs: nextStartUs,
          pseudo: true,
          backgroundColor: 'backgroundColor' in clip ? clip.backgroundColor : undefined,
          text: 'text' in clip ? clip.text : undefined,
          style: 'style' in clip ? clip.style : undefined,
          shapeType: 'shapeType' in clip ? clip.shapeType : undefined,
          hudType: 'hudType' in clip ? clip.hudType : undefined,
        });
      }

      // Translate linked IDs if the target is also being pasted
      const translatedLinkedVideoId = clip.linkedVideoClipId
        ? idMap.get(clip.linkedVideoClipId) || clip.linkedVideoClipId
        : undefined;
      const translatedGroupId = clip.linkedGroupId
        ? idMap.get(clip.linkedGroupId) || clip.linkedGroupId
        : undefined;

      commands.push({
        type: 'update_clip_properties',
        trackId,
        itemId: newClipId,
        properties: {
          disabled: clip.disabled,
          locked: clip.locked,
          opacity: clip.opacity,
          blendMode: clip.blendMode,
          effects: cloneClip(clip.effects ?? []),
          freezeFrameSourceUs: clip.freezeFrameSourceUs,
          speed: clip.speed,
          transform: cloneValue(clip.transform),
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
          sourceRange: clip.sourceRange,
          sourceDurationUs: clip.sourceDurationUs,
          audioFromVideoDisabled: clip.audioFromVideoDisabled,
          linkedVideoClipId: translatedLinkedVideoId,
          lockToLinkedVideo: clip.lockToLinkedVideo,
          linkedGroupId: translatedGroupId,
          backgroundColor: 'backgroundColor' in clip ? clip.backgroundColor : undefined,
          text: 'text' in clip ? clip.text : undefined,
          style: 'style' in clip ? cloneValue(clip.style) : undefined,
          shapeType: 'shapeType' in clip ? clip.shapeType : undefined,
          fillColor: 'fillColor' in clip ? clip.fillColor : undefined,
          strokeColor: 'strokeColor' in clip ? clip.strokeColor : undefined,
          strokeWidth: 'strokeWidth' in clip ? clip.strokeWidth : undefined,
          shapeConfig: 'shapeConfig' in clip ? cloneValue(clip.shapeConfig) : undefined,
          hudType: 'hudType' in clip ? clip.hudType : undefined,
          background: 'background' in clip ? cloneValue(clip.background) : undefined,
          content: 'content' in clip ? cloneValue(clip.content) : undefined,
        },
      });

      if (clip.transitionIn || clip.transitionOut) {
        commands.push({
          type: 'update_clip_transition',
          trackId,
          itemId: newClipId,
          transitionIn: cloneValue(clip.transitionIn),
          transitionOut: cloneValue(clip.transitionOut),
        });
      }
    }

    if (commands.length > 0) {
      deps.batchApplyTimeline(commands, {
        labelKey: 'timeline.pasteItems',
        saveMode: 'debounced',
      });
    }

    return pasteDescriptor;
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
