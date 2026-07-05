/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, ref, type EffectScope } from 'vue';
import { useClipDrop } from '~/composables/timeline/useClipDrop';
import { clearDndZones, DND_ZONE_ATTR, getDndZone } from '~/composables/dnd/dndRegistry';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';

vi.mock('~/effects', () => ({
  getAudioEffectManifest: vi.fn((type: string) =>
    type === 'echo'
      ? { type: 'echo', defaultValues: { delay: 0.25 } }
      : undefined,
  ),
  getVideoEffectManifest: vi.fn((type: string) =>
    type === 'blur'
      ? { type: 'blur', defaultValues: { strength: 12 } }
      : undefined,
  ),
}));

vi.mock('~/transitions', () => ({
  DEFAULT_TRANSITION_CURVE: 'linear',
  DEFAULT_TRANSITION_MODE: 'adjacent',
  getTransitionManifest: vi.fn((type: string) =>
    type === 'dissolve' ? { type: 'dissolve' } : undefined,
  ),
  normalizeTransitionParams: vi.fn(() => ({})),
}));

const baseClip: TimelineClipItem = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  clipType: 'media',
  name: 'Clip',
  source: { path: '_video/clip.mp4' },
  sourceRange: { startUs: 0, durationUs: 5_000_000 },
  sourceDurationUs: 5_000_000,
  timelineRange: { startUs: 0, durationUs: 5_000_000 },
};

const baseVideoTrack: TimelineTrack = {
  id: 'track-1',
  kind: 'video',
  name: 'Video',
  items: [baseClip],
};

function makeContext(payload: DndPayload, targetEl: Element | null = null): DndDragContext {
  return {
    payload,
    pointer: {
      clientX: 0,
      clientY: 0,
      pointerType: 'mouse',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    },
    zoneId: 'clip-1',
    targetEl,
    setOperation: vi.fn(),
  };
}

function makeClipElement({ left, width }: { left: number; width: number }) {
  const el = document.createElement('div');
  el.dataset.clipId = 'clip-1';
  el.getBoundingClientRect = () => ({ left, width }) as DOMRect;
  return el;
}

function setupDropZone(options?: {
  track?: TimelineTrack;
  clip?: TimelineClipItem | null;
  canEdit?: boolean;
  defaultTransitionDurationUs?: number;
}) {
  let scope: EffectScope | undefined;
  const updateClipProperties = vi.fn();
  const updateClipTransition = vi.fn();
  const selectTimelineItem = vi.fn();
  const selectTimelineTransition = vi.fn();
  const triggerScrollToEffects = vi.fn();

  const track = ref(options?.track ?? baseVideoTrack);
  const clipItem = ref(options?.clip ?? baseClip);
  const canEditClipContent = ref(options?.canEdit ?? true);
  const defaultTransitionDurationUs = ref(options?.defaultTransitionDurationUs ?? 1_000_000);

  scope = effectScope();
  const api = scope.run(() =>
    useClipDrop({
      track: computed(() => track.value),
      clipItem: computed(() => clipItem.value),
      canEditClipContent: computed(() => canEditClipContent.value),
      updateClipProperties,
      updateClipTransition,
      selectTimelineItem,
      selectTimelineTransition,
      triggerScrollToEffects,
      defaultTransitionDurationUs: computed(() => defaultTransitionDurationUs.value),
    }),
  );

  if (!api) throw new Error('useClipDrop did not initialize');

  const zoneId = api.dropZoneAttrs[DND_ZONE_ATTR];
  const handlers = getDndZone(zoneId);
  if (!handlers) throw new Error('DND zone was not registered');

  return {
    handlers,
    scope,
    track,
    clipItem,
    updateClipProperties,
    updateClipTransition,
    selectTimelineItem,
    selectTimelineTransition,
    triggerScrollToEffects,
  };
}

describe('useClipDrop', () => {
  afterEach(() => {
    clearDndZones();
    vi.useRealTimers();
  });

  it('adds a compatible video effect when it is dropped on a video clip', () => {
    vi.useFakeTimers();
    const drop = setupDropZone();
    const payload: DndPayload = { source: 'effect', data: { type: 'blur' } };

    expect(drop.handlers.canAccept?.(payload)).toBe(true);
    drop.handlers.onDrop?.(makeContext(payload));

    expect(drop.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      effects: [
        expect.objectContaining({
          type: 'blur',
          enabled: true,
          target: 'video',
          strength: 12,
        }),
      ],
    });
    expect(drop.selectTimelineItem).toHaveBeenCalledWith('track-1', 'clip-1', 'clip');

    vi.runAllTimers();
    expect(drop.triggerScrollToEffects).toHaveBeenCalledTimes(1);
    drop.scope.stop();
  });

  it('rejects video-only effects and visual transitions on audio clips', () => {
    const audioTrack: TimelineTrack = {
      ...baseVideoTrack,
      id: 'audio-1',
      kind: 'audio',
      name: 'Audio',
    };
    const drop = setupDropZone({ track: audioTrack });

    const videoEffect: DndPayload = { source: 'effect', data: { type: 'blur' } };
    const visualTransition: DndPayload = { source: 'transition', data: { type: 'dissolve' } };

    expect(drop.handlers.canAccept?.(videoEffect)).toBe(false);
    expect(drop.handlers.canAccept?.(visualTransition)).toBe(false);

    drop.handlers.onDrop?.(makeContext(videoEffect));
    drop.handlers.onDrop?.(makeContext(visualTransition));

    expect(drop.updateClipProperties).not.toHaveBeenCalled();
    expect(drop.updateClipTransition).not.toHaveBeenCalled();
    drop.scope.stop();
  });

  it('adds a transition to the clip edge under the pointer', () => {
    const drop = setupDropZone({ defaultTransitionDurationUs: 2_000_000 });
    const payload: DndPayload = { source: 'transition', data: { type: 'dissolve' } };
    const clipEl = makeClipElement({ left: 10, width: 100 });

    expect(drop.handlers.canAccept?.(payload)).toBe(true);

    drop.handlers.onDrop?.({
      ...makeContext(payload, clipEl),
      pointer: {
        ...makeContext(payload).pointer,
        clientX: 35,
      },
    });
    expect(drop.updateClipTransition).toHaveBeenLastCalledWith('track-1', 'clip-1', {
      transitionIn: expect.objectContaining({
        type: 'dissolve',
        durationUs: 1_500_000,
        mode: 'adjacent',
        curve: 'linear',
        params: {},
      }),
    });
    expect(drop.selectTimelineTransition).toHaveBeenLastCalledWith('track-1', 'clip-1', 'in');

    drop.handlers.onDrop?.({
      ...makeContext(payload, clipEl),
      pointer: {
        ...makeContext(payload).pointer,
        clientX: 95,
      },
    });
    expect(drop.updateClipTransition).toHaveBeenLastCalledWith('track-1', 'clip-1', {
      transitionOut: expect.objectContaining({
        type: 'dissolve',
      }),
    });
    expect(drop.selectTimelineTransition).toHaveBeenLastCalledWith('track-1', 'clip-1', 'out');
    drop.scope.stop();
  });
});
