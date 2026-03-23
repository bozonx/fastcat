import type { TimelineDocument, TimelineClipItem, TimelineTrack } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

import { computeCutUs } from '~/timeline/domain/editing';

interface HotkeyTarget {
  trackId: string;
  itemId: string;
}

interface ApplyTimelineOptions {
  saveMode?: 'debounced' | 'immediate' | 'none';
  skipHistory?: boolean;
  historyMode?: 'immediate' | 'debounced';
  historyDebounceMs?: number;
  labelKey?: string;
}

export interface TimelineEditServiceDeps {
  getDoc: () => TimelineDocument | null;
  getHotkeyTargetClip: () => HotkeyTarget | null;
  getSelectedItemIds: () => string[];
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: ApplyTimelineOptions) => void;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: ApplyTimelineOptions) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
}

interface RippleDeleteRangeParams {
  trackIds: string[];
  startUs: number;
  endUs: number;
}

export function createTimelineEditService(deps: TimelineEditServiceDeps) {
  function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack | null {
    return doc.tracks.find((t) => t.id === trackId) ?? null;
  }

  function rippleDeleteRange(input: RippleDeleteRangeParams, options?: ApplyTimelineOptions) {
    const doc = deps.getDoc();
    if (!doc) return;

    const startUs = computeCutUs(doc, input.startUs);
    const endUs = computeCutUs(doc, input.endUs);
    if (!(endUs > startUs)) return;

    const deltaUs = endUs - startUs;
    const trackIdSet = new Set(input.trackIds);
    const batchOptions: ApplyTimelineOptions = options ?? {
      saveMode: 'none',
      historyMode: 'debounced',
      historyDebounceMs: 100,
    };

    // Phase 1: split at endUs then startUs (sequential — each split changes doc state)
    const splitTargets: Array<{ trackId: string; itemId: string }> = [];
    for (const track of doc.tracks) {
      if (!trackIdSet.has(track.id)) continue;
      if (track.locked) continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        splitTargets.push({ trackId: track.id, itemId: it.id });
      }
    }

    const splitCmdsEnd: TimelineCommand[] = splitTargets.map((t) => ({
      type: 'split_item',
      trackId: t.trackId,
      itemId: t.itemId,
      atUs: endUs,
    }));
    if (splitCmdsEnd.length > 0) {
      deps.batchApplyTimeline(splitCmdsEnd, batchOptions);
    }

    const splitCmdsStart: TimelineCommand[] = splitTargets.map((t) => ({
      type: 'split_item',
      trackId: t.trackId,
      itemId: t.itemId,
      atUs: startUs,
    }));
    if (splitCmdsStart.length > 0) {
      deps.batchApplyTimeline(splitCmdsStart, batchOptions);
    }

    // Phase 2: delete clips in range
    const updated = deps.getDoc();
    if (!updated) return;

    const deleteCmds: TimelineCommand[] = [];
    for (const track of updated.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      if (track.locked) continue;

      const toDelete: string[] = [];
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;
        if (center >= startUs && center <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deleteCmds.push({ type: 'delete_items', trackId: track.id, itemIds: toDelete });
      }
    }
    if (deleteCmds.length > 0) {
      deps.batchApplyTimeline(deleteCmds, batchOptions);
    }

    // Phase 3: shift clips after the deleted range
    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    const moveCmds: TimelineCommand[] = [];
    for (const track of afterDelete.tracks) {
      if (!trackIdSet.has(track.id)) continue;
      if (track.locked) continue;

      const clips = track.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        if (clip.locked) continue;
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          moveCmds.push({
            type: 'move_item',
            trackId: track.id,
            itemId: clip.id,
            startUs: Math.max(0, clipStart - deltaUs),
            quantizeToFrames: false,
          });
        }
      }
    }
    if (moveCmds.length > 0) {
      deps.batchApplyTimeline(moveCmds, batchOptions);
    }
  }

  async function rippleTrimRight() {
    const doc = deps.getDoc();
    if (!doc) return;

    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return;

    deps.applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    const updatedDoc = deps.getDoc();
    if (!updatedDoc) return;
    const updatedTrack = getTrackById(updatedDoc, target.trackId);
    if (!updatedTrack) return;

    const subsequentClips = updatedTrack.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= endUs - 10);

    for (const clip of subsequentClips) {
      deps.applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
          quantizeToFrames: false,
        },
        { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
      );
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function rippleTrimLeft() {
    const doc = deps.getDoc();
    if (!doc) return;

    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return;

    deps.applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs,
      },
      { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
    );

    const updatedDoc = deps.getDoc();
    if (!updatedDoc) return;
    const updatedTrack = getTrackById(updatedDoc, target.trackId);
    if (!updatedTrack) return;

    const clipsToShift = updatedTrack.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= cutUs - 10);

    for (const clip of clipsToShift) {
      deps.applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
          quantizeToFrames: false,
        },
        { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
      );
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function advancedRippleTrimRight() {
    const doc = deps.getDoc();
    if (!doc) return;

    if (deps.getSelectedItemIds().length !== 1) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return;

    const splitAt = (atUs: number) => {
      for (const t of doc.tracks) {
        if (t.locked) continue;
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            deps.applyTimeline(
              { type: 'split_item', trackId: t.id, itemId: it.id, atUs },
              { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
            );
          }
        }
      }
    };

    splitAt(endUs);
    splitAt(cutUs);

    const updated = deps.getDoc();
    if (!updated) return;

    for (const t of updated.tracks) {
      if (t.locked) continue;
      const toDelete: string[] = [];
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= cutUs && center <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deps.applyTimeline(
          { type: 'delete_items', trackId: t.id, itemIds: toDelete },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const t of afterDelete.tracks) {
      if (t.locked) continue;
      const clips = t.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        if (clip.locked) continue;
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          deps.applyTimeline(
            {
              type: 'move_item',
              trackId: t.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
              quantizeToFrames: false,
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  async function advancedRippleTrimLeft() {
    const doc = deps.getDoc();
    if (!doc) return;

    if (deps.getSelectedItemIds().length !== 1) return;
    const target = deps.getHotkeyTargetClip();
    if (!target) return;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;
    if (track.locked || item.locked) return;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return;

    const splitAt = (atUs: number) => {
      for (const t of doc.tracks) {
        if (t.locked) continue;
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            deps.applyTimeline(
              { type: 'split_item', trackId: t.id, itemId: it.id, atUs },
              { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
            );
          }
        }
      }
    };

    splitAt(cutUs);
    splitAt(startUs);

    const updated = deps.getDoc();
    if (!updated) return;

    for (const t of updated.tracks) {
      if (t.locked) continue;
      const toDelete: string[] = [];
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= startUs && center <= cutUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deps.applyTimeline(
          { type: 'delete_items', trackId: t.id, itemIds: toDelete },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const t of afterDelete.tracks) {
      if (t.locked) continue;
      const clips = t.items
        .filter((it): it is TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        if (clip.locked) continue;
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= cutUs - EPSILON) {
          deps.applyTimeline(
            {
              type: 'move_item',
              trackId: t.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
              quantizeToFrames: false,
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }

    await deps.requestTimelineSave({ immediate: true });
  }

  return {
    rippleTrimRight,
    rippleTrimLeft,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    rippleDeleteRange,
  };
}
