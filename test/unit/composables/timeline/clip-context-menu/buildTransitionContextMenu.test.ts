/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { buildTransitionContextMenu } from '~/composables/timeline/clip-context-menu/buildTransitionContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

vi.mock('~/transitions', () => ({
  DEFAULT_TRANSITION_CURVE: 'linear',
  DEFAULT_TRANSITION_MODE: 'overwrite',
}));

function makeOptions(overrides?: Partial<UseClipContextMenuOptions>): UseClipContextMenuOptions {
  return {
    track: { value: { id: 't1', kind: 'video', items: [], locked: false } } as any,
    item: {
      value: {
        id: 'clip1',
        kind: 'clip',
        transitionIn: null,
        transitionOut: null,
        timelineRange: { startUs: 0, durationUs: 2000000 },
      },
    } as any,
    t: vi.fn((key: string) => key),
    defaultTransitionDurationUs: { value: 1000000 } as any,
    updateClipTransition: vi.fn(),
    clearSelection: vi.fn(),
    selectTransition: vi.fn(),
    selectTimelineTransition: vi.fn(),
    ...overrides,
  } as unknown as UseClipContextMenuOptions;
}

describe('buildTransitionContextMenu', () => {
  it('returns null for non-clip items', () => {
    const opts = makeOptions({
      item: { value: { id: 'gap1', kind: 'gap' } } as any,
    });
    expect(buildTransitionContextMenu(opts)).toBeNull();
  });

  it('returns null for non-video tracks', () => {
    const opts = makeOptions({
      track: { value: { id: 't1', kind: 'audio', items: [] } } as any,
    });
    expect(buildTransitionContextMenu(opts)).toBeNull();
  });

  it('returns menu with add transition in/out when no transitions', () => {
    const opts = makeOptions();
    const result = buildTransitionContextMenu(opts);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]).toHaveLength(2);
    expect(result![0][0].label).toBe('fastcat.timeline.addTransitionIn');
    expect(result![0][1].label).toBe('fastcat.timeline.addTransitionOut');
  });

  it('returns menu with remove transition in when transitionIn exists', () => {
    const opts = makeOptions({
      item: {
        value: {
          id: 'clip1',
          kind: 'clip',
          transitionIn: { type: 'dissolve', durationUs: 500000 },
          transitionOut: null,
          timelineRange: { startUs: 0, durationUs: 2000000 },
        },
      } as any,
    });
    const result = buildTransitionContextMenu(opts);
    expect(result![0][0].label).toBe('fastcat.timeline.removeTransitionIn');
    expect(result![0][1].label).toBe('fastcat.timeline.addTransitionOut');
  });

  it('returns menu with remove transition out when transitionOut exists', () => {
    const opts = makeOptions({
      item: {
        value: {
          id: 'clip1',
          kind: 'clip',
          transitionIn: null,
          transitionOut: { type: 'dissolve', durationUs: 500000 },
          timelineRange: { startUs: 0, durationUs: 2000000 },
        },
      } as any,
    });
    const result = buildTransitionContextMenu(opts);
    expect(result![0][0].label).toBe('fastcat.timeline.addTransitionIn');
    expect(result![0][1].label).toBe('fastcat.timeline.removeTransitionOut');
  });

  it('add transition in onSelect calls updateClipTransition', () => {
    const updateClipTransition = vi.fn();
    const selectTransition = vi.fn();
    const selectTimelineTransition = vi.fn();
    const opts = makeOptions({ updateClipTransition, selectTransition, selectTimelineTransition });
    const result = buildTransitionContextMenu(opts);
    result![0][0].onSelect!();
    expect(updateClipTransition).toHaveBeenCalledWith('t1', 'clip1', {
      transitionIn: expect.objectContaining({ type: 'dissolve' }),
    });
    expect(selectTransition).toHaveBeenCalledWith({ trackId: 't1', itemId: 'clip1', edge: 'in' });
    expect(selectTimelineTransition).toHaveBeenCalledWith('t1', 'clip1', 'in');
  });

  it('remove transition in onSelect calls updateClipTransition with null', () => {
    const updateClipTransition = vi.fn();
    const clearSelection = vi.fn();
    const opts = makeOptions({
      updateClipTransition,
      clearSelection,
      item: {
        value: {
          id: 'clip1',
          kind: 'clip',
          transitionIn: { type: 'dissolve', durationUs: 500000 },
          transitionOut: null,
          timelineRange: { startUs: 0, durationUs: 2000000 },
        },
      } as any,
    });
    const result = buildTransitionContextMenu(opts);
    result![0][0].onSelect!();
    expect(updateClipTransition).toHaveBeenCalledWith('t1', 'clip1', { transitionIn: null });
    expect(clearSelection).toHaveBeenCalled();
  });

  it('uses 30% of clip duration when clip is shorter than default', () => {
    const opts = makeOptions({
      item: {
        value: {
          id: 'clip1',
          kind: 'clip',
          transitionIn: null,
          transitionOut: null,
          timelineRange: { startUs: 0, durationUs: 500000 },
        },
      } as any,
      defaultTransitionDurationUs: { value: 1000000 } as any,
    });
    const updateClipTransition = vi.fn();
    opts.updateClipTransition = updateClipTransition;
    const result = buildTransitionContextMenu(opts);
    result![0][0].onSelect!();
    expect(updateClipTransition).toHaveBeenCalledWith('t1', 'clip1', {
      transitionIn: expect.objectContaining({ durationUs: 150000 }),
    });
  });
});
