/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import { usePlaybackHotkeys } from '~/composables/editor/hotkeys/usePlaybackHotkeys';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';

describe('usePlaybackHotkeys — F / D speed cycle', () => {
  let handlers: ReturnType<typeof usePlaybackHotkeys>;

  beforeEach(() => {
    setActivePinia(createPinia());
    handlers = usePlaybackHotkeys(createHotkeyHoldRunner());

    const focusStore = useFocusStore();
    focusStore.setPanelFocus('timeline');

    const timelineStore = useTimelineStore();
    timelineStore.setPlaybackSpeed(1);
    if (timelineStore.isPlaying) timelineStore.togglePlayback();
  });

  const run = (cmd: 'playback.speedUpForward' | 'playback.speedDown') =>
    handlers[cmd]?.(new KeyboardEvent('keydown'));

  describe('F (playback.speedUpForward)', () => {
    it('starts forward at 1.25x when paused and begins playback', () => {
      const timelineStore = useTimelineStore();
      expect(timelineStore.isPlaying).toBe(false);

      const result = run('playback.speedUpForward');

      expect(result).toBe(true);
      expect(timelineStore.playbackSpeed).toBe(1.25);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('starts at 1.25x when currently playing in reverse', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(-1);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');

      expect(timelineStore.playbackSpeed).toBe(1.25);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('starts at 1.25x when currently playing forward below 1.25x', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(0.5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');

      expect(timelineStore.playbackSpeed).toBe(1.25);
    });

    it('climbs the grid one step per press while playing forward >= 1.25x', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(1.25);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');
      expect(timelineStore.playbackSpeed).toBe(1.5);

      run('playback.speedUpForward');
      expect(timelineStore.playbackSpeed).toBe(1.75);

      run('playback.speedUpForward');
      expect(timelineStore.playbackSpeed).toBe(2);
    });

    it('clamps at the 5x ceiling', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');
      expect(timelineStore.playbackSpeed).toBe(5);
    });
  });

  describe('D (playback.speedDown)', () => {
    it('steps down from 1x baseline when paused (first step 0.75x) and plays', () => {
      const timelineStore = useTimelineStore();
      expect(timelineStore.isPlaying).toBe(false);

      const result = run('playback.speedDown');

      expect(result).toBe(true);
      expect(timelineStore.playbackSpeed).toBe(0.75);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('continues down from the current forward speed while playing', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(1.5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedDown');
      expect(timelineStore.playbackSpeed).toBe(1.25);
    });

    it('crosses from forward into reverse through the zero gap', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(0.5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedDown');
      expect(timelineStore.playbackSpeed).toBe(-0.5);

      run('playback.speedDown');
      expect(timelineStore.playbackSpeed).toBe(-0.75);
    });

    it('clamps at the -5x floor', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(-5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedDown');
      expect(timelineStore.playbackSpeed).toBe(-5);
    });

    it('restarts from 1x baseline when paused after reversing (first step 0.75x)', () => {
      const timelineStore = useTimelineStore();
      // Was reversing, now paused.
      timelineStore.setPlaybackSpeed(-2);
      expect(timelineStore.isPlaying).toBe(false);

      run('playback.speedDown');
      expect(timelineStore.playbackSpeed).toBe(0.75);
      expect(timelineStore.isPlaying).toBe(true);
    });
  });

  it('returns false when no panel is focused', () => {
    const focusStore = useFocusStore();
    focusStore.setPanelFocus(null as never);

    expect(run('playback.speedUpForward')).toBe(false);
    expect(run('playback.speedDown')).toBe(false);
  });

  it('the 1.5x commands (formerly F/D) are still registered as handlers', () => {
    // F/D were freed from forward1_5/backward1_5, but the handlers themselves remain.
    expect(typeof handlers['playback.forward1_5']).toBe('function');
    expect(typeof handlers['playback.backward1_5']).toBe('function');
  });
});
