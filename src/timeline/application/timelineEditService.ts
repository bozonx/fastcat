import type {
  TimelineDocument,
  TimelineClipItem,
  TimelineSelectionRange,
  TimelineTrack,
} from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineApplyOptions } from '~/timeline/apply-options';

import { buildRippleMarkerCommands } from '~/timeline/domain/markers';
import { computeCutUs } from '~/timeline/domain/editing';
import {
  getLinkedClipGroupItemIds,
  getDocFps,
  quantizeDeltaUsToFrames,
} from '~/timeline/commands/utils';

interface HotkeyTarget {
  trackId: string;
  itemId: string;
}

export interface TimelineEditServiceDeps {
  getDoc: () => TimelineDocument | null;
  getHotkeyTargetClip: () => HotkeyTarget | null;
  getSelectedItemIds: () => string[];
  getCurrentTime: () => number;
  applyTimeline: (cmd: TimelineCommand, options?: TimelineApplyOptions) => void;
  batchApplyTimeline: (cmds: TimelineCommand[], options?: TimelineApplyOptions) => void;
  pushTimelineHistory: (preState: TimelineDocument, commandType: string, labelKey: string) => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getSelectionRange?: () => TimelineSelectionRange | null;
  updateSelectionRange?: (range: TimelineSelectionRange | null) => void;
}

interface RippleDeleteRangeParams {
  trackIds: string[];
  startUs: number;
  endUs: number;
}

export function createTimelineEditService(deps: TimelineEditServiceDeps) {
  function rippleSelectionRange(
    selectionRange: TimelineSelectionRange,
    rangeStartUs: number,
    rangeEndUs: number,
  ): TimelineSelectionRange | null {
    if (!(rangeEndUs > rangeStartUs)) return selectionRange;

    const deltaUs = rangeEndUs - rangeStartUs;
    const selectionStartUs = selectionRange.startUs;
    const selectionEndUs = selectionRange.endUs;

    if (selectionEndUs <= rangeStartUs) return selectionRange;
    if (selectionStartUs >= rangeEndUs) {
      return {
        startUs: Math.max(0, selectionStartUs - deltaUs),
        endUs: Math.max(0, selectionEndUs - deltaUs),
      };
    }
    if (selectionStartUs >= rangeStartUs && selectionEndUs <= rangeEndUs) return null;
    if (selectionStartUs < rangeStartUs && selectionEndUs > rangeEndUs) {
      return {
        startUs: selectionStartUs,
        endUs: Math.max(selectionStartUs, selectionEndUs - deltaUs),
      };
    }
    if (selectionStartUs < rangeStartUs) {
      return {
        startUs: selectionStartUs,
        endUs: Math.max(selectionStartUs, rangeStartUs),
      };
    }

    const nextStartUs = Math.max(0, rangeStartUs);
    const nextEndUs = Math.max(nextStartUs, selectionEndUs - deltaUs);
    return {
      startUs: nextStartUs,
      endUs: nextEndUs,
    };
  }

  function applyRippleSelectionRange(rangeStartUs: number, rangeEndUs: number) {
    if (!deps.getSelectionRange || !deps.updateSelectionRange) return;

    const selectionRange = deps.getSelectionRange();
    if (!selectionRange) return;

    deps.updateSelectionRange(rippleSelectionRange(selectionRange, rangeStartUs, rangeEndUs));
  }

  function getTrackById(doc: TimelineDocument, trackId: string): TimelineTrack | null {
    return doc.tracks.find((t) => t.id === trackId) ?? null;
  }

  /**
   * Builds the ripple moves for a single-track ripple-trim that nonetheless must
   * keep a linked group in sync. `trim_item` retimes EVERY member of the trimmed
   * clip's linked group (across tracks), so the gap it opens exists on each of
   * those tracks — not just the target track. Shifting only the target track left
   * (the old behaviour) left every linked partner after the cut un-rippled and
   * therefore desynced. Here we ripple the clips after the gap on each track that
   * holds a group member, by the same `deltaUs`, excluding the members themselves
   * (their own start is handled by the trim / explicit move). The gap boundary on
   * each track is that track's group-member right edge.
   */
  function buildGroupRippleMoves(params: {
    doc: TimelineDocument;
    targetItemId: string;
    deltaUs: number;
  }): Array<{ fromTrackId: string; toTrackId: string; itemId: string; startUs: number }> {
    const groupIds = new Set(getLinkedClipGroupItemIds(params.doc, params.targetItemId));

    const memberEndByTrack = new Map<string, number>();
    for (const t of params.doc.tracks) {
      for (const it of t.items) {
        if (it.kind === 'clip' && groupIds.has(it.id)) {
          const end = it.timelineRange.startUs + it.timelineRange.durationUs;
          memberEndByTrack.set(t.id, Math.max(memberEndByTrack.get(t.id) ?? 0, end));
        }
      }
    }

    const moves: Array<{
      fromTrackId: string;
      toTrackId: string;
      itemId: string;
      startUs: number;
    }> = [];
    for (const t of params.doc.tracks) {
      if (t.locked) continue;
      const memberEnd = memberEndByTrack.get(t.id);
      if (memberEnd === undefined) continue;
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (groupIds.has(it.id)) continue;
        if (it.locked) continue;
        if (it.timelineRange.startUs < memberEnd) continue;
        moves.push({
          fromTrackId: t.id,
          toTrackId: t.id,
          itemId: it.id,
          startUs: Math.max(0, it.timelineRange.startUs - params.deltaUs),
        });
      }
    }
    return moves;
  }

  function rippleDeleteRange(
    input: RippleDeleteRangeParams,
    options?: TimelineApplyOptions,
  ): number | null {
    const doc = deps.getDoc();
    if (!doc) return null;
    const preState = doc;

    const startUs = computeCutUs(doc, input.startUs);
    const endUs = computeCutUs(doc, input.endUs);
    if (!(endUs > startUs)) return null;

    const deltaUs = endUs - startUs;
    const trackIdSet = new Set(input.trackIds);
    const batchOptions: TimelineApplyOptions = options ?? {
      saveMode: 'none',
    };
    const internalBatchOptions: TimelineApplyOptions = {
      ...batchOptions,
      skipHistory: true,
    };

    const buildSplitCmds = (fromDoc: TimelineDocument, atUs: number): TimelineCommand[] => {
      const cmds: TimelineCommand[] = [];
      for (const track of fromDoc.tracks) {
        if (!trackIdSet.has(track.id)) continue;
        if (track.locked) continue;
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.locked) continue;
          const itStart = it.timelineRange.startUs;
          const itEnd = itStart + it.timelineRange.durationUs;
          if (!(atUs > itStart && atUs < itEnd)) continue;
          cmds.push({ type: 'split_item', trackId: track.id, itemId: it.id, atUs });
        }
      }
      return cmds;
    };

    // Phase 1: split at endUs then startUs (sequential — each split changes doc state)
    const splitCmdsEnd = buildSplitCmds(doc, endUs);
    if (splitCmdsEnd.length > 0) {
      deps.batchApplyTimeline(splitCmdsEnd, internalBatchOptions);
    }

    const afterSplitEnd = deps.getDoc();
    if (!afterSplitEnd) return null;

    const splitCmdsStart = buildSplitCmds(afterSplitEnd, startUs);
    if (splitCmdsStart.length > 0) {
      deps.batchApplyTimeline(splitCmdsStart, internalBatchOptions);
    }

    // Phase 2: delete clips that lie entirely within the cut range.
    const updated = deps.getDoc();
    if (!updated) return null;

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
        // inside or entirely outside [startUs, endUs]. Use exact edges instead
        // of the midpoint heuristic, which fails around split boundaries.
        if (itStart >= startUs && itEnd <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        deleteCmds.push({ type: 'delete_items', trackId: track.id, itemIds: toDelete });
      }
    }
    if (deleteCmds.length > 0) {
      deps.batchApplyTimeline(deleteCmds, internalBatchOptions);
    }

    // Phase 3: shift clips after the deleted range by the exact removed delta.
    const afterDelete = deps.getDoc();
    if (!afterDelete) return null;

    // Collapse every downstream shift into a SINGLE `move_items` command. Emitting
    // one `move_item` per clip made the ripple O(clips²) — each command rebuilt the
    // whole document, so a cut with N trailing clips paid N full-doc rebuilds (the
    // measured ~291ms/187-command batch). `move_items` applies all shifts in one
    // rebuild. `ignoreLinks` mirrors the established `rippleTrimRight` path: every
    // affected clip is enumerated explicitly, so link-following is unnecessary.
    const moves: Extract<TimelineCommand, { type: 'move_items' }>['moves'] = [];
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
        if (clipStart >= endUs) {
          // Clamp to startUs so a clip that starts at the cut boundary cannot
          // overlap the pre-cut region.
          const nextStart = Math.max(startUs, clipStart - deltaUs);
          moves.push({
            fromTrackId: track.id,
            toTrackId: track.id,
            itemId: clip.id,
            startUs: nextStart,
          });
        }
      }
    }
    if (moves.length > 0) {
      deps.batchApplyTimeline(
        [{ type: 'move_items', moves, quantizeToFrames: false, ignoreLinks: true }],
        internalBatchOptions,
      );
    }

    // Phase 4: update markers in the same way the clips were moved.
    const markerDoc = deps.getDoc();
    if (markerDoc) {
      const markerCmds = buildRippleMarkerCommands(markerDoc, startUs, endUs);
      if (markerCmds.length > 0) {
        deps.batchApplyTimeline(markerCmds, internalBatchOptions);
      }
    }
    applyRippleSelectionRange(startUs, endUs);

    const finalDoc = deps.getDoc();
    if (finalDoc && finalDoc !== preState && !options?.skipHistory) {
      deps.pushTimelineHistory(
        preState,
        'delete_items',
        options?.labelKey ?? 'videoEditor.fileManager.history.entries.deleteItems',
      );
    }

    return startUs;
  }

  async function rippleTrimRight(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    // Frame-align the ripple amount up front so the end trim and the subsequent
    // shift use the EXACT same delta. Otherwise the trim quantizes `endUs - cutUs`
    // to frames while the moves quantize each clip's start independently, which
    // can leave a sub-frame gap/overlap on legacy non-frame-aligned geometry.
    const deltaUs = quantizeDeltaUsToFrames(endUs - cutUs, getDocFps(doc), 'round');
    if (deltaUs <= 0) return null;

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
    ];

    const moves = buildGroupRippleMoves({ doc, targetItemId: target.itemId, deltaUs });

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: false,
        ignoreLinks: true,
      });
    }

    // rippleTrimRight removes [cutUs, endUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, cutUs, cutUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });
    applyRippleSelectionRange(cutUs, cutUs + deltaUs);

    await deps.requestTimelineSave({ immediate: true });
    return cutUs;
  }

  async function rippleTrimLeft(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    // Frame-align the ripple amount up front so the start trim, the move-back and
    // the subsequent shift all use the EXACT same delta (see rippleTrimRight).
    const deltaUs = quantizeDeltaUsToFrames(cutUs - startUs, getDocFps(doc), 'round');
    if (deltaUs <= 0) return null;

    const cmds: TimelineCommand[] = [
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs,
      },
      // A start-edge trim parks the clip at the cut (its left edge moves to
      // cutUs). Slide the surviving portion back to the original left edge so it
      // fills the removed span instead of leaving a gap — the left counterpart
      // of rippleTrimRight, where trimming the end keeps the start fixed. Links
      // are honored so locked linked audio (already retimed by the trim above)
      // follows the clip.
      {
        type: 'move_item',
        trackId: target.trackId,
        itemId: target.itemId,
        startUs,
        quantizeToFrames: false,
      },
    ];

    const moves = buildGroupRippleMoves({ doc, targetItemId: target.itemId, deltaUs });

    if (moves.length > 0) {
      cmds.push({
        type: 'move_items',
        moves,
        quantizeToFrames: false,
        ignoreLinks: true,
      });
    }

    // rippleTrimLeft removes [startUs, cutUs] of timeline space.
    cmds.push(...buildRippleMarkerCommands(doc, startUs, startUs + deltaUs));

    deps.batchApplyTimeline(cmds, {
      saveMode: 'none',
      labelKey: 'videoEditor.fileManager.history.entries.trimClip',
    });
    applyRippleSelectionRange(startUs, startUs + deltaUs);

    await deps.requestTimelineSave({ immediate: true });
    return startUs;
  }

  async function advancedRippleTrimRight(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    if (deps.getSelectedItemIds().length !== 1) return null;
    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return null;

    const collapseUs = rippleDeleteRange(
      {
        trackIds: doc.tracks.map((item) => item.id),
        startUs: cutUs,
        endUs,
      },
      {
        saveMode: 'none',
        labelKey: 'videoEditor.fileManager.history.entries.trimClip',
      },
    );
    if (collapseUs === null) return null;
    await deps.requestTimelineSave({ immediate: true });
    return collapseUs;
  }

  async function advancedRippleTrimLeft(): Promise<number | null> {
    const doc = deps.getDoc();
    if (!doc) return null;

    if (deps.getSelectedItemIds().length !== 1) return null;
    const target = deps.getHotkeyTargetClip();
    if (!target) return null;

    const track = getTrackById(doc, target.trackId);
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return null;
    if (track.locked || item.locked) return null;

    const cutUs = computeCutUs(doc, deps.getCurrentTime());
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    if (!(cutUs > startUs && cutUs < endUs)) return null;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return null;

    const collapseUs = rippleDeleteRange(
      {
        trackIds: doc.tracks.map((item) => item.id),
        startUs,
        endUs: cutUs,
      },
      {
        saveMode: 'none',
        labelKey: 'videoEditor.fileManager.history.entries.trimClip',
      },
    );
    if (collapseUs === null) return null;
    await deps.requestTimelineSave({ immediate: true });
    return collapseUs;
  }

  return {
    rippleTrimRight,
    rippleTrimLeft,
    advancedRippleTrimRight,
    advancedRippleTrimLeft,
    rippleDeleteRange,
  };
}
