import { describe, expect, it } from 'vitest';
import {
  useTimelineMovePreviews,
  type MovePreviewEntry,
} from '~/composables/timeline/useTimelineMovePreviews';

function track(id: string, itemIds: string[]): any {
  return {
    id,
    items: itemIds.map((itemId) => ({
      id: itemId,
      kind: 'clip',
      timelineRange: { startTicks: 0, durationTicks: 1000 },
    })),
  };
}

const tracks = [track('t1', ['a', 'b']), track('t2', ['c'])];

function build(
  movePreview: MovePreviewEntry[] | undefined,
  draggingMode: 'move' | 'slip' | null = 'move',
) {
  return useTimelineMovePreviews({
    tracks: () => tracks,
    movePreview: () => movePreview,
    draggingMode: () => draggingMode,
  });
}

describe('useTimelineMovePreviews', () => {
  it('groups preview ghosts by track and resolves the underlying item', () => {
    const { movePreviewItemsByTrack, movePreviewIds } = build([
      { itemId: 'a', trackId: 't1', startTicks: 500, isCollision: false },
      { itemId: 'c', trackId: 't2', startTicks: 800, isCollision: true },
    ]);

    expect(movePreviewItemsByTrack.value.t1?.map((e) => e.item.id)).toEqual(['a']);
    expect(movePreviewItemsByTrack.value.t2?.[0]?.preview.isCollision).toBe(true);
    expect([...movePreviewIds.value]).toEqual(['a', 'c']);
  });

  it('ignores previews whose item is not present in the tracks', () => {
    const { movePreviewItemsByTrack } = build([{ itemId: 'ghost', trackId: 't1', startTicks: 0 }]);
    expect(movePreviewItemsByTrack.value.t1).toBeUndefined();
  });

  it('suppresses ghosts entirely while slipping', () => {
    const { movePreviewItemsByTrack, movePreviewIds, movePreviewMemoByTrack } = build(
      [{ itemId: 'a', trackId: 't1', startTicks: 500 }],
      'slip',
    );
    expect(movePreviewItemsByTrack.value).toEqual({});
    expect(movePreviewIds.value.size).toBe(0);
    expect(movePreviewMemoByTrack.value).toEqual({});
  });

  it('builds a per-track memo string encoding id/start/collision', () => {
    const { movePreviewMemoByTrack } = build([
      { itemId: 'a', trackId: 't1', startTicks: 500, isCollision: false },
      { itemId: 'b', trackId: 't1', startTicks: 700, isCollision: true },
    ]);
    expect(movePreviewMemoByTrack.value.t1).toBe('a:500:0|b:700:1|');
  });
});
