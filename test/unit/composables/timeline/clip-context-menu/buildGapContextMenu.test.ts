/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { buildGapContextMenu } from '~/composables/timeline/clip-context-menu/buildGapContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

function makeOptions(overrides?: Partial<UseClipContextMenuOptions>): UseClipContextMenuOptions {
  return {
    track: { value: { id: 't1', kind: 'video', items: [], locked: false } } as any,
    item: {
      value: { id: 'gap1', kind: 'gap', timelineRange: { startUs: 0, durationUs: 1000 } },
    } as any,
    t: vi.fn((key: string) => key),
    hasTimelineClipboard: true,
    getHotkeyKbds: vi.fn(() => ['Ctrl+V']),
    pasteClips: vi.fn(),
    applyTimelineCommand: vi.fn(),
    ...overrides,
  } as unknown as UseClipContextMenuOptions;
}

describe('buildGapContextMenu', () => {
  it('returns null for non-gap items', () => {
    const opts = makeOptions({
      item: { value: { id: 'clip1', kind: 'clip' } } as any,
    });
    expect(buildGapContextMenu(opts)).toBeNull();
  });

  it('returns menu with paste and delete for gap items', () => {
    const opts = makeOptions();
    const result = buildGapContextMenu(opts);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]).toHaveLength(2);
    expect(result![0][0].label).toBe('common.paste');
    expect(result![0][1].label).toBe('fastcat.timeline.delete');
  });

  it('disables paste when no clipboard', () => {
    const opts = makeOptions({ hasTimelineClipboard: false });
    const result = buildGapContextMenu(opts);
    expect(result![0][0].disabled).toBe(true);
  });

  it('enables paste when clipboard exists', () => {
    const opts = makeOptions({ hasTimelineClipboard: true });
    const result = buildGapContextMenu(opts);
    expect(result![0][0].disabled).toBe(false);
  });

  it('paste onSelect calls pasteClips with startUs', () => {
    const pasteClips = vi.fn();
    const opts = makeOptions({ pasteClips });
    const result = buildGapContextMenu(opts);
    result![0][0].onSelect!();
    expect(pasteClips).toHaveBeenCalledWith(0);
  });

  it('delete onSelect calls applyTimelineCommand with delete_items', () => {
    const applyTimelineCommand = vi.fn();
    const opts = makeOptions({ applyTimelineCommand });
    const result = buildGapContextMenu(opts);
    result![0][1].onSelect!();
    expect(applyTimelineCommand).toHaveBeenCalledWith({
      type: 'delete_items',
      trackId: 't1',
      itemIds: ['gap1'],
    });
  });
});
