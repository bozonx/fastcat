/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  computeCutUs,
  buildSplitClipCommands,
  buildSplitAllClipsCommands,
  buildSplitSelectedClipsCommands,
} from '~/timeline/domain/editing';

vi.mock('~/timeline/commands/utils', () => ({
  quantizeTimeUsToFrames: vi.fn((atUs) => atUs),
  getDocFps: vi.fn(() => 30),
}));

const mockDoc: any = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      locked: false,
      items: [
        {
          id: 'clip-1',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          locked: false,
        },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
          locked: true,
        },
        { id: 'gap-1', kind: 'gap', timelineRange: { startUs: 2_000_000, durationUs: 500_000 } },
      ],
    },
    {
      id: 'track-2',
      locked: true,
      items: [
        {
          id: 'clip-3',
          kind: 'clip',
          timelineRange: { startUs: 0, durationUs: 2_000_000 },
          locked: false,
        },
      ],
    },
  ],
};

describe('computeCutUs', () => {
  it('returns quantized time', () => {
    expect(computeCutUs(mockDoc, 500_000)).toBe(500_000);
  });
});

describe('buildSplitClipCommands', () => {
  it('returns empty for null target', () => {
    expect(buildSplitClipCommands(mockDoc, 500_000, null)).toEqual([]);
  });

  it('returns split command for target', () => {
    const cmds = buildSplitClipCommands(mockDoc, 500_000, { trackId: 'track-1', itemId: 'clip-1' });
    expect(cmds).toEqual([
      { type: 'split_item', trackId: 'track-1', itemId: 'clip-1', atUs: 500_000 },
    ]);
  });
});

describe('buildSplitAllClipsCommands', () => {
  it('skips locked tracks and locked items', () => {
    const cmds = buildSplitAllClipsCommands(mockDoc, 500_000);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].itemId).toBe('clip-1');
  });

  it('skips items where cutUs is outside range', () => {
    const cmds = buildSplitAllClipsCommands(mockDoc, 3_000_000);
    expect(cmds).toEqual([]);
  });
});

describe('buildSplitSelectedClipsCommands', () => {
  it('filters to selected items only', () => {
    const cmds = buildSplitSelectedClipsCommands(mockDoc, 500_000, ['clip-1']);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].itemId).toBe('clip-1');
  });

  it('ignores unselected items', () => {
    const cmds = buildSplitSelectedClipsCommands(mockDoc, 500_000, ['clip-2']);
    expect(cmds).toEqual([]);
  });

  it('treats empty selection as no filter', () => {
    const cmds = buildSplitSelectedClipsCommands(mockDoc, 500_000, []);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].itemId).toBe('clip-1');
  });
});
