import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import type { ClipTransform, TimelineClipItem, TrackKind } from '~/timeline/types';

function makeClip(partial: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'c1',
    trackId: 'custom-track',
    name: 'C1',
    timelineRange: { startUs: 0, durationUs: 1_000_000 },
    sourceRange: { startUs: 0, durationUs: 1_000_000 },
    source: { path: 'a.mp4' },
    sourceDurationUs: 10_000_000,
    ...partial,
  } as TimelineClipItem;
}

describe('useClipTransform', () => {
  it('computes canEditTransform based on trackKind', () => {
    const clip = ref(makeClip({ trackId: 'custom-track' }));
    const trackKind = ref<TrackKind>('video');
    const api = useClipTransform({
      clip,
      trackKind,
      updateTransform: () => {},
    });
    expect(api.canEditTransform.value).toBe(true);

    trackKind.value = 'audio';
    expect(api.canEditTransform.value).toBe(false);
  });

  it('does not infer canEditTransform from trackId without trackKind', () => {
    const clip = ref(makeClip({ trackId: 'v2' }));
    const api = useClipTransform({
      clip,
      updateTransform: () => {},
    });

    expect(api.canEditTransform.value).toBe(false);
  });

  it('updates linked scale when setting scaleX', () => {
    let updated: ClipTransform | null = null;
    const clip = ref(
      makeClip({
        transform: {
          scale: { x: 1, y: 1, linked: true },
        },
      }) as any,
    );

    const api = useClipTransform({
      clip,
      updateTransform: (next: ClipTransform) => {
        updated = next;
      },
    });

    api.transformScaleX.value = 200;
    if (!updated) {
      throw new Error('Expected updateTransform to be called');
    }
    const next: ClipTransform = updated;
    expect(next.scale?.x).toBe(2);
    expect(next.scale?.y).toBe(2);
    expect(next.scale?.linked).toBe(true);
  });

  it('clamps custom anchor coordinates to supported range', () => {
    let updated: ClipTransform | null = null;
    const clip = ref(
      makeClip({
        transform: {
          anchor: { preset: 'custom', x: 0.5, y: 0.5 },
        },
      }) as TimelineClipItem,
    );

    const api = useClipTransform({
      clip,
      trackKind: ref<TrackKind>('video'),
      updateTransform: (next: ClipTransform) => {
        updated = next;
      },
    });

    api.transformAnchorX.value = 99;
    api.transformAnchorY.value = -99;

    if (!updated) {
      throw new Error('Expected updateTransform to be called');
    }

    const next: ClipTransform = updated;
    expect(next.anchor?.x).toBeLessThanOrEqual(10);
    expect(next.anchor?.y).toBeGreaterThanOrEqual(-10);
  });
});
