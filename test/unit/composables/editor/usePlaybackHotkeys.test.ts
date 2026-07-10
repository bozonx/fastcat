/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import { usePlaybackHotkeys } from '~/composables/editor/hotkeys/usePlaybackHotkeys';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';

describe('usePlaybackHotkeys — F / D speed cycle', () => {
  let handlers: ReturnType<typeof usePlaybackHotkeys>;

  beforeEach(() => {
    setActivePinia(createPinia());
    handlers = usePlaybackHotkeys(createHotkeyHoldRunner());

    const focusStore = useFocusStore();
    focusStore.setPanelFocus('timeline');
    pressedKeyCodes.clear();

    const timelineStore = useTimelineStore();
    timelineStore.setPlaybackSpeed(1);
    if (timelineStore.isPlaying) timelineStore.togglePlayback();
  });

  const run = (cmd: 'playback.speedUpForward' | 'playback.speedDown') =>
    handlers[cmd]?.(new KeyboardEvent('keydown'));

  describe('Space (playback.toggle1)', () => {
    it('starts playback at 1x when paused', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(2);

      const result = handlers['playback.toggle1']?.(new KeyboardEvent('keydown'));

      expect(result).toBe(true);
      expect(timelineStore.playbackSpeed).toBe(1);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('stops playback and resets speed to 1x when playing', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(2);
      timelineStore.togglePlayback();

      const result = handlers['playback.toggle1']?.(new KeyboardEvent('keydown'));

      expect(result).toBe(true);
      expect(timelineStore.playbackSpeed).toBe(1);
      expect(timelineStore.isPlaying).toBe(false);
    });
  });

  describe('F (playback.speedUpForward)', () => {
    it('steps up from 1x baseline when paused (first step 1.25x) and begins playback', () => {
      const timelineStore = useTimelineStore();
      expect(timelineStore.isPlaying).toBe(false);

      const result = run('playback.speedUpForward');

      expect(result).toBe(true);
      expect(timelineStore.playbackSpeed).toBe(1.25);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('steps up from the current speed while playing in reverse (-1 -> -0.75)', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(-1);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');

      expect(timelineStore.playbackSpeed).toBe(-0.75);
      expect(timelineStore.isPlaying).toBe(true);
    });

    it('steps up from the current speed while playing forward below 1.25x (0.5 -> 0.75)', () => {
      const timelineStore = useTimelineStore();
      timelineStore.setPlaybackSpeed(0.5);
      if (!timelineStore.isPlaying) timelineStore.togglePlayback();

      run('playback.speedUpForward');

      expect(timelineStore.playbackSpeed).toBe(0.75);
    });

    it('climbs the grid one step per press while playing forward', () => {
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

  describe('J / K / L shuttle stop modifier', () => {
    it('steps one frame forward when the bare shuttle stop key is held with shuttle forward', () => {
      const holdRunner = createHotkeyHoldRunner();
      handlers = usePlaybackHotkeys(
        holdRunner,
        computed(
          () =>
            ({
              'playback.shuttleStop': ['K'],
            }) as any,
        ),
      );
      const timelineStore = useTimelineStore();
      const seekFrames = vi.fn();
      timelineStore.seekFrames = seekFrames;
      pressedKeyCodes.add('KeyK');

      const result = handlers['playback.shuttleForward']?.(
        new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' }),
      );

      expect(result).toBe(true);
      expect(seekFrames).toHaveBeenCalledWith(1);
      expect(timelineStore.isPlaying).toBe(false);
      holdRunner.clearTimers();
    });

    it('steps one frame backward when the bare shuttle stop key is held with shuttle reverse', () => {
      const holdRunner = createHotkeyHoldRunner();
      handlers = usePlaybackHotkeys(
        holdRunner,
        computed(
          () =>
            ({
              'playback.shuttleStop': ['K'],
            }) as any,
        ),
      );
      const timelineStore = useTimelineStore();
      const seekFrames = vi.fn();
      timelineStore.seekFrames = seekFrames;
      pressedKeyCodes.add('KeyK');

      const result = handlers['playback.shuttleReverse']?.(
        new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j' }),
      );

      expect(result).toBe(true);
      expect(seekFrames).toHaveBeenCalledWith(-1);
      expect(timelineStore.isPlaying).toBe(false);
      holdRunner.clearTimers();
    });

    it('repeats held shuttle steps at roughly one third playback speed', () => {
      vi.useFakeTimers();
      const holdRunner = createHotkeyHoldRunner();
      try {
        handlers = usePlaybackHotkeys(
          holdRunner,
          computed(
            () =>
              ({
                'playback.shuttleStop': ['K'],
              }) as any,
          ),
        );
        const timelineStore = useTimelineStore();
        const seekFrames = vi.fn();
        timelineStore.seekFrames = seekFrames;
        timelineStore.timelineDoc = { timebase: { fps: 30 } } as any;
        pressedKeyCodes.add('KeyK');

        handlers['playback.shuttleForward']?.(
          new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' }),
        );

        expect(seekFrames).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(449);
        expect(seekFrames).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(seekFrames).toHaveBeenCalledTimes(2);
      } finally {
        holdRunner.clearTimers();
        vi.useRealTimers();
      }
    });

    it('does not treat modifier shuttle stop combos as physical shuttle modifiers', () => {
      handlers = usePlaybackHotkeys(
        createHotkeyHoldRunner(),
        computed(
          () =>
            ({
              'playback.shuttleStop': ['Shift+K'],
            }) as any,
        ),
      );
      const timelineStore = useTimelineStore();
      const seekFrames = vi.fn();
      timelineStore.seekFrames = seekFrames;
      pressedKeyCodes.add('KeyK');

      const result = handlers['playback.shuttleForward']?.(
        new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' }),
      );

      expect(result).toBe(true);
      expect(seekFrames).not.toHaveBeenCalled();
      expect(timelineStore.isPlaying).toBe(true);
    });
  });
});
