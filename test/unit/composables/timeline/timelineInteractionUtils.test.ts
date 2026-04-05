/** @vitest-environment happy-dom */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveMoveTargetTrackId } from '~/composables/timeline/timelineInteractionUtils';

describe('timelineInteractionUtils', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prefers track row by Y position over elementsFromPoint result', () => {
    const track1 = document.createElement('div');
    track1.dataset.trackId = 'v1';
    vi.spyOn(track1, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      bottom: 50,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });

    const track2 = document.createElement('div');
    track2.dataset.trackId = 'v2';
    vi.spyOn(track2, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 50,
      top: 50,
      bottom: 100,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });

    document.body.append(track1, track2);

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [track1]),
    });

    const result = resolveMoveTargetTrackId({
      clientX: 100,
      clientY: 75,
      draggingTrackId: 'v1',
      tracks: [
        { id: 'v1', kind: 'video', locked: false, items: [] },
        { id: 'v2', kind: 'video', locked: false, items: [] },
      ] as any,
    });

    expect(result).toBe('v2');
  });
});
