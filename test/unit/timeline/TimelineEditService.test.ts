/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTimelineEditService } from '~/timeline/application/timelineEditService';
import type { TimelineDocument, TimelineCommand } from '~/timeline/types';

describe('TimelineEditService', () => {
  let mockDoc: TimelineDocument;
  let deps: any;
  let service: ReturnType<typeof createTimelineEditService>;

  beforeEach(() => {
    mockDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc1',
      name: 'Test',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'V1',
          items: [
            {
              id: 'c1',
              kind: 'clip',
              trackId: 'v1',
              name: 'C1',
              timelineRange: { startUs: 0, durationUs: 10_000_000 },
            },
            {
              id: 'c2',
              kind: 'clip',
              trackId: 'v1',
              name: 'C2',
              timelineRange: { startUs: 10_000_000, durationUs: 10_000_000 },
            },
          ],
        },
      ],
    } as any;

    deps = {
      getDoc: vi.fn(() => mockDoc),
      getHotkeyTargetClip: vi.fn(),
      getSelectedItemIds: vi.fn(() => []),
      getCurrentTime: vi.fn(() => 0),
      applyTimeline: vi.fn(),
      batchApplyTimeline: vi.fn((cmds: TimelineCommand[]) => {
        // Reasonably faithful mock: split actually shortens the source clip
        // and inserts a tail. Phase 2 of rippleDeleteRange depends on clips
        // being fully inside [startUs, endUs], which only holds after splits.
        for (const cmd of cmds) {
          if (cmd.type === 'delete_items') {
            const track = (mockDoc.tracks as any[]).find((t) => t.id === cmd.trackId);
            if (track) {
              track.items = track.items.filter((it: any) => !cmd.itemIds.includes(it.id));
            }
          }
          if (cmd.type === 'split_item') {
            const track = (mockDoc.tracks as any[]).find((t) => t.id === cmd.trackId);
            if (!track) continue;
            const idx = track.items.findIndex((it: any) => it.id === cmd.itemId);
            if (idx === -1) continue;
            const item = track.items[idx];
            const start = item.timelineRange.startUs;
            const end = start + item.timelineRange.durationUs;
            const atUs = (cmd as any).atUs;
            if (!(atUs > start && atUs < end)) continue;
            const left = {
              ...item,
              timelineRange: { startUs: start, durationUs: atUs - start },
            };
            const right = {
              ...item,
              id: `${item.id}_tail_${atUs}`,
              timelineRange: { startUs: atUs, durationUs: end - atUs },
            };
            track.items.splice(idx, 1, left, right);
          }
        }
      }),
      requestTimelineSave: vi.fn(() => Promise.resolve()),
    };

    service = createTimelineEditService(deps);
  });

  describe('rippleDeleteRange', () => {
    it('calls split, delete and move commands correctly', () => {
      // Ripple delete from 5s to 15s.
      // C1 (0-10s) should be split at 5s.
      // C2 (10-20s) should be split at 15s.
      // The range [5, 15] should be deleted.
      // C2 tail should move left by 10s.

      service.rippleDeleteRange({
        trackIds: ['v1'],
        startUs: 5_000_000,
        endUs: 15_000_000,
      });

      // Phase 1: Split
      // It calls batchApplyTimeline with split commands
      expect(deps.batchApplyTimeline).toHaveBeenCalled();

      const splitCalls = deps.batchApplyTimeline.mock.calls.filter((c) =>
        c[0].some((cmd: TimelineCommand) => cmd.type === 'split_item'),
      );
      expect(splitCalls.length).toBeGreaterThanOrEqual(1);

      // Phase 2: Delete
      const deleteCalls = deps.batchApplyTimeline.mock.calls.filter((c) =>
        c[0].some((cmd: TimelineCommand) => cmd.type === 'delete_items'),
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

      // Phase 3: Move
      const moveCalls = deps.batchApplyTimeline.mock.calls.filter((c) =>
        c[0].some((cmd: TimelineCommand) => cmd.type === 'move_item'),
      );
      expect(moveCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('rippleTrimRight', () => {
    it('trims end and moves subsequent clips in a single batch', async () => {
      deps.getHotkeyTargetClip.mockReturnValue({ trackId: 'v1', itemId: 'c1' });
      deps.getCurrentTime.mockReturnValue(5_000_000); // Trim C1 to 5s (current end is 10s)

      await service.rippleTrimRight();

      // The whole ripple operation should now go through batchApplyTimeline,
      // not the per-command applyTimeline path.
      expect(deps.applyTimeline).not.toHaveBeenCalled();
      expect(deps.batchApplyTimeline).toHaveBeenCalledTimes(1);

      const batch = deps.batchApplyTimeline.mock.calls[0][0] as TimelineCommand[];

      // First command: trim c1 right edge by -5s.
      expect(batch[0]).toEqual(
        expect.objectContaining({
          type: 'trim_item',
          itemId: 'c1',
          edge: 'end',
          deltaUs: -5_000_000,
        }),
      );

      // Subsequent clips collapsed into a single move_items command.
      // c2 is at 10s, deltaUs is 5s → c2 moves to 5s.
      const moveItemsCmd = batch.find((cmd: TimelineCommand) => cmd.type === 'move_items') as
        | Extract<TimelineCommand, { type: 'move_items' }>
        | undefined;
      expect(moveItemsCmd).toBeDefined();
      expect(moveItemsCmd!.moves).toEqual([
        expect.objectContaining({ itemId: 'c2', startUs: 5_000_000 }),
      ]);
    });
  });
});
