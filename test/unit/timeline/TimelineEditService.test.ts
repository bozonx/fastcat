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
        // Simple mock implementation: Phase 1 sends splits, Phase 2 sends deletes
        for (const cmd of cmds) {
          if (cmd.type === 'delete_items') {
            const track = (mockDoc.tracks as any[]).find((t) => t.id === cmd.trackId);
            if (track) {
              track.items = track.items.filter((it: any) => !cmd.itemIds.includes(it.id));
            }
          }
          if (cmd.type === 'split_item') {
            // For split at endUs (15s), we need a clip that starts there to be moved in Phase 3
            if (cmd.atUs === 15_000_000) {
              const track = (mockDoc.tracks as any[]).find((t) => t.id === cmd.trackId);
              if (track) {
                track.items.push({
                  id: 'c2_tail',
                  kind: 'clip',
                  timelineRange: { startUs: 15_000_000, durationUs: 5_000_000 },
                } as any);
              }
            }
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
    it('trims end and moves subsequent clips', async () => {
      deps.getHotkeyTargetClip.mockReturnValue({ trackId: 'v1', itemId: 'c1' });
      deps.getCurrentTime.mockReturnValue(5_000_000); // Trim C1 to 5s (current end is 10s)

      await service.rippleTrimRight();

      // Should apply trim to c1
      expect(deps.applyTimeline).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trim_item',
          itemId: 'c1',
          edge: 'end',
          deltaUs: -5_000_000,
        }),
        expect.anything(),
      );

      // Subsequent clips should be moved left by 5s.
      // c2 is at 10s. deltaUs is 5s.
      expect(deps.applyTimeline).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'move_item',
          itemId: 'c2',
          startUs: 5_000_000,
        }),
        expect.anything(),
      );
    });
  });
});
