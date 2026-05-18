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

  /**
   * Returns commands that remove/shrink markers overlapping [rangeStartUs, rangeEndUs] and
   * shift markers starting at/after rangeEndUs left by (rangeEndUs - rangeStartUs).
   * Pure — does not apply anything. Useful for inclusion in larger batches so a single
   * history entry and reactive flush cover both clip and marker changes.
   */
  function buildRippleMarkerCommands(
    doc: TimelineDocument,
    rangeStartUs: number,
    rangeEndUs: number,
  ): TimelineCommand[] {
    if (!(rangeEndUs > rangeStartUs)) return [];
    const deltaUs = rangeEndUs - rangeStartUs;
    const markers = (doc.metadata?.fastcat?.markers ?? []) as Array<{
      id: string;
      timeUs: number;
      durationUs?: number;
    }>;
    if (markers.length === 0) return [];

    const cmds: TimelineCommand[] = [];
    for (const m of markers) {
      const mStart = m.timeUs;
      const mEnd = m.timeUs + Math.max(0, m.durationUs ?? 0);
      if (mEnd <= rangeStartUs) continue;
      if (mStart >= rangeEndUs) {
        cmds.push({ type: 'update_marker', id: m.id, timeUs: Math.max(0, mStart - deltaUs) });
        continue;
      }
      if (mStart >= rangeStartUs && mEnd <= rangeEndUs) {
        cmds.push({ type: 'remove_marker', id: m.id });
        continue;
      }
      if (mStart < rangeStartUs && mEnd > rangeEndUs) {
        cmds.push({
          type: 'update_marker',
          id: m.id,
          timeUs: mStart,
          durationUs: Math.max(0, (m.durationUs ?? 0) - deltaUs),
        });
        continue;
      }
      if (mStart < rangeStartUs) {
        cmds.push({
          type: 'update_marker',
          id: m.id,
          timeUs: mStart,
          durationUs: Math.max(0, rangeStartUs - mStart),
        });
        continue;
      }
      // Head overlap: marker starts inside the range, extends past it.
      const newStart = Math.max(0, rangeStartUs);
      const newEnd = Math.max(newStart, mEnd - deltaUs);
      cmds.push({
        type: 'update_marker',
        id: m.id,
        timeUs: newStart,
        durationUs: Math.max(0, newEnd - newStart),
      });
    }
    return cmds;
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

    // Phase 2: delete clips that lie entirely (or all but an epsilon) within the cut range.
    const updated = deps.getDoc();
    if (!updated) return;

    const EPSILON = 10;
    const deleteCmds: TimelineCommand[] = [];
    for (const track of updated.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      if (track.locked) continue;

      const toDelete: string[] = [];
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        // After the splits at startUs and endUs every survivor either lies entirely
        // inside or entirely outside [startUs, endUs]. Use the actual edges (with
        // epsilon) instead of the midpoint — the midpoint heuristic fails when the
        // split was quantized to a frame boundary.
        if (itStart >= startUs - EPSILON && itEnd <= endUs + EPSILON) {
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

    // Phase 3: shift clips after the deleted range, preserving frame alignment.
    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

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
            // Quantize so the ripple keeps clips on frame boundaries.
            quantizeToFrames: true,
          });
        }
      }
    }
    if (moveCmds.length > 0) {
      deps.batchApplyTimeline(moveCmds, batchOptions);
    }

    // Phase 4: update markers in the same way the clips were moved.
    const markerDoc = deps.getDoc();
    if (markerDoc) {
      const markerCmds = buildRippleMarkerCommands(markerDoc, startUs, endUs);
      if (markerCmds.length > 0) {
        deps.batchApplyTimeline(markerCmds, batchOptions);
      }
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

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
    ];

    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];

    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === target.itemId) continue;
      if (it.timelineRange.startUs < endUs - 10) continue;
      moves.push({
        fromTrackId: target.trackId,
        toTrackId: target.trackId,
        itemId: it.id,
        startUs: Math.max(0, it.timelineRange.startUs - deltaUs),
      });
    }

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: true,
        ignoreLinks: true,
      });
    }

    // rippleTrimRight removes [cutUs, endUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, cutUs, cutUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });

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

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs,
      },
    ];

    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];

    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === target.itemId) continue;
      if (it.timelineRange.startUs < cutUs - 10) continue;
      moves.push({
        fromTrackId: target.trackId,
        toTrackId: target.trackId,
        itemId: it.id,
        startUs: Math.max(0, it.timelineRange.startUs - deltaUs),
      });
    }

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: true,
        ignoreLinks: true,
      });
    }

    // rippleTrimLeft removes [startUs, cutUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, startUs, startUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });

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

    const batchOptions: ApplyTimelineOptions = {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    };

    const buildSplitCmds = (atUs: number, fromDoc: TimelineDocument): TimelineCommand[] => {
      const cmds: TimelineCommand[] = [];
      for (const t of fromDoc.tracks) {
        if (t.locked) continue;
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            cmds.push({ type: 'split_item', trackId: t.id, itemId: it.id, atUs });
          }
        }
      }
      return cmds;
    };

    // Phase 1: split at endUs then cutUs (separate batches — split changes IDs).
    const splitEnd = buildSplitCmds(endUs, doc);
    if (splitEnd.length > 0) deps.batchApplyTimeline(splitEnd, batchOptions);
    const afterSplitEnd = deps.getDoc();
    if (!afterSplitEnd) return;

    const splitCut = buildSplitCmds(cutUs, afterSplitEnd);
    if (splitCut.length > 0) deps.batchApplyTimeline(splitCut, batchOptions);

    // Phase 2: delete clips whose center lies inside [cutUs, endUs].
    const updated = deps.getDoc();
    if (!updated) return;

    const deleteCmds: TimelineCommand[] = [];
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
        deleteCmds.push({ type: 'delete_items', trackId: t.id, itemIds: toDelete });
      }
    }
    if (deleteCmds.length > 0) deps.batchApplyTimeline(deleteCmds, batchOptions);

    // Phase 3: shift surviving clips left across every track.
    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];
    for (const t of afterDelete.tracks) {
      if (t.locked) continue;
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const clipStart = it.timelineRange.startUs;
        if (clipStart < endUs - EPSILON) continue;
        moves.push({
          fromTrackId: t.id,
          toTrackId: t.id,
          itemId: it.id,
          startUs: Math.max(0, clipStart - deltaUs),
        });
      }
    }
    if (moves.length > 0) {
      deps.batchApplyTimeline(
        [{ type: 'move_items', moves, quantizeToFrames: false, ignoreLinks: true }],
        batchOptions,
      );
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

    const batchOptions: ApplyTimelineOptions = {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    };

    const buildSplitCmds = (atUs: number, fromDoc: TimelineDocument): TimelineCommand[] => {
      const cmds: TimelineCommand[] = [];
      for (const t of fromDoc.tracks) {
        if (t.locked) continue;
        for (const it of t.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (atUs > itStart && atUs < itEnd) {
            cmds.push({ type: 'split_item', trackId: t.id, itemId: it.id, atUs });
          }
        }
      }
      return cmds;
    };

    // Phase 1: split at cutUs then startUs (separate batches — split changes IDs).
    const splitCut = buildSplitCmds(cutUs, doc);
    if (splitCut.length > 0) deps.batchApplyTimeline(splitCut, batchOptions);
    const afterSplitCut = deps.getDoc();
    if (!afterSplitCut) return;

    const splitStart = buildSplitCmds(startUs, afterSplitCut);
    if (splitStart.length > 0) deps.batchApplyTimeline(splitStart, batchOptions);

    // Phase 2: delete clips whose center lies inside [startUs, cutUs].
    const updated = deps.getDoc();
    if (!updated) return;

    const deleteCmds: TimelineCommand[] = [];
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
        deleteCmds.push({ type: 'delete_items', trackId: t.id, itemIds: toDelete });
      }
    }
    if (deleteCmds.length > 0) deps.batchApplyTimeline(deleteCmds, batchOptions);

    // Phase 3: shift surviving clips left across every track.
    const afterDelete = deps.getDoc();
    if (!afterDelete) return;

    const EPSILON = 10;
    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];
    for (const t of afterDelete.tracks) {
      if (t.locked) continue;
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (it.locked) continue;
        const clipStart = it.timelineRange.startUs;
        if (clipStart < cutUs - EPSILON) continue;
        moves.push({
          fromTrackId: t.id,
          toTrackId: t.id,
          itemId: it.id,
          startUs: Math.max(0, clipStart - deltaUs),
        });
      }
    }
    if (moves.length > 0) {
      deps.batchApplyTimeline(
        [{ type: 'move_items', moves, quantizeToFrames: false, ignoreLinks: true }],
        batchOptions,
      );
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
