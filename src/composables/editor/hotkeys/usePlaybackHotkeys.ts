import type { ComputedRef } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useUiStore } from '~/stores/ui.store';
import type { HotkeyCommandId, HotkeyCombo } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFps } from '~/timeline/commands/utils';
import { isPreviewLikeFocus } from '~/utils/hotkeys/runtime';
import { hotkeyComboToBareKeyCode } from '~/utils/hotkeys/hotkeyUtils';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';
import { nextShuttleSpeed, stepPlaybackSpeed, type ShuttleDirection } from '~/utils/playbackSpeeds';

import type { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

export function usePlaybackHotkeys(
  playbackStepHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
  effectiveHotkeys?: ComputedRef<Record<HotkeyCommandId, HotkeyCombo[]>>,
) {
  const timelineStore = useTimelineStore();
  const focusStore = useFocusStore();
  const uiStore = useUiStore();

  function canUsePlaybackOrTimelineFocus() {
    return focusStore.canUsePlaybackHotkeys || focusStore.effectiveFocus === 'timeline';
  }

  function hasActivePreviewPlaybackTarget() {
    return isPreviewLikeFocus(focusStore.effectiveFocus) && uiStore.hasActivePreviewPlayer;
  }

  function getPlaybackStepSeconds(frames: number) {
    const fps = timelineStore.timelineDoc ? getDocFps(timelineStore.timelineDoc) : 30;
    return frames / fps;
  }

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'playback.toggle': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('toggle');
        return true;
      }

      timelineStore.togglePlayback();
      return true;
    },

    'playback.toggle1': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('toggle1');
        return true;
      }

      timelineStore.setPlaybackSpeed(1);
      timelineStore.togglePlayback();
      return true;
    },

    'playback.play1ResetSpeed': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('set', 1, 'forward');
        return true;
      }

      timelineStore.setPlaybackSpeed(1);
      if (!timelineStore.isPlaying) {
        timelineStore.togglePlayback();
      }
      return true;
    },

    'timeline.globalToStart': () => {
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('toStart');
        return true;
      }

      timelineStore.goToStart();
      return true;
    },

    'timeline.globalToEnd': () => {
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('toEnd');
        return true;
      }

      timelineStore.goToEnd();
      return true;
    },

    'playback.stepForward': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('step', undefined, undefined, getPlaybackStepSeconds(1));
        return true;
      }
      if (isPreviewLikeFocus(focusStore.effectiveFocus)) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.seekFrames(1);
        },
      });
      return true;
    },

    'playback.stepBackward': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('step', undefined, undefined, getPlaybackStepSeconds(-1));
        return true;
      }
      if (isPreviewLikeFocus(focusStore.effectiveFocus)) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.seekFrames(-1);
        },
      });
      return true;
    },

    'playback.stepForwardLarge': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('step', undefined, undefined, 1);
        return true;
      }
      if (isPreviewLikeFocus(focusStore.effectiveFocus)) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(
            (timelineStore.timelineDoc ||
              ({} as { format?: { fps?: number } })) as import('~/timeline/types').TimelineDocument,
          );
          timelineStore.seekFrames(fps);
        },
      });
      return true;
    },

    'playback.stepBackwardLarge': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('step', undefined, undefined, -1);
        return true;
      }
      if (isPreviewLikeFocus(focusStore.effectiveFocus)) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(
            (timelineStore.timelineDoc ||
              ({} as { format?: { fps?: number } })) as import('~/timeline/types').TimelineDocument,
          );
          timelineStore.seekFrames(-fps);
        },
      });
      return true;
    },

    'playback.jumpPrevBoundary': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;
      timelineStore.jumpToPrevClipBoundary();
      return true;
    },

    'playback.jumpNextBoundary': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;
      timelineStore.jumpToNextClipBoundary();
      return true;
    },

    'playback.jumpPrevBoundaryTrack': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;
      timelineStore.jumpToPrevClipBoundary({ currentTrackOnly: true });
      return true;
    },

    'playback.jumpNextBoundaryTrack': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;
      timelineStore.jumpToNextClipBoundary({ currentTrackOnly: true });
      return true;
    },

    // F — step playback speed UP the grid by one position.
    // Continues from the current speed while playing (or 1x baseline when
    // paused), advancing one grid step per press up to the 5x ceiling.
    'playback.speedUpForward': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('speedUpForward');
        return true;
      }

      const { playbackSpeed, isPlaying } = timelineStore;
      const fromSpeed = isPlaying ? playbackSpeed : 1;
      const nextSpeed = stepPlaybackSpeed(fromSpeed, 'up');
      timelineStore.setPlaybackSpeed(nextSpeed);
      if (!isPlaying) timelineStore.togglePlayback();
      return true;
    },

    // D — cycle playback speed DOWN the grid by one step.
    // Baseline is 1x (so the first step lands on 0.75x) unless already playing
    // (forward or reverse), in which case it continues from the current speed.
    // Walking off the bottom crosses into reverse: 0.5 → -0.5 → -0.75 … → -5.
    'playback.speedDown': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('speedDownForward');
        return true;
      }

      const { playbackSpeed, isPlaying } = timelineStore;
      const fromSpeed = isPlaying ? playbackSpeed : 1;
      const nextSpeed = stepPlaybackSpeed(fromSpeed, 'down');
      timelineStore.setPlaybackSpeed(nextSpeed);
      if (!isPlaying) timelineStore.togglePlayback();
      return true;
    },

    // L — classic shuttle forward; with shuttle stop held, step frames instead.
    'playback.shuttleForward': (e) => shuttleOrStep(e, 'forward'),

    // J — classic shuttle reverse; with shuttle stop held, step frames instead.
    'playback.shuttleReverse': (e) => shuttleOrStep(e, 'backward'),

    // K — classic shuttle stop: pause and drop the shuttle speed back to 1x so
    // the next transport command starts from a predictable baseline.
    'playback.shuttleStop': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (hasActivePreviewPlaybackTarget()) {
        uiStore.triggerPreviewPlayback('pauseReset');
        return true;
      }

      if (timelineStore.isPlaying) timelineStore.togglePlayback();
      timelineStore.setPlaybackSpeed(1);
      return true;
    },
  };

  function shuttle(direction: ShuttleDirection): boolean {
    if (!canUsePlaybackOrTimelineFocus()) return false;
    if (hasActivePreviewPlaybackTarget()) {
      if (direction === 'forward') {
        uiStore.triggerPreviewPlayback('speedUpForward');
      }
      return true;
    }

    const { playbackSpeed, isPlaying } = timelineStore;
    timelineStore.setPlaybackSpeed(nextShuttleSpeed(playbackSpeed, isPlaying, direction));
    if (!isPlaying) timelineStore.togglePlayback();
    return true;
  }

  function getShuttleStopModifierCodes(): string[] {
    const combos = effectiveHotkeys?.value['playback.shuttleStop'] ?? [];
    return combos
      .map((combo) => hotkeyComboToBareKeyCode(combo))
      .filter((code): code is string => Boolean(code));
  }

  function isShuttleStopModifierHeld() {
    return getShuttleStopModifierCodes().some((code) => pressedKeyCodes.has(code));
  }

  function shuttleOrStep(e: KeyboardEvent, direction: ShuttleDirection): boolean {
    if (!isShuttleStopModifierHeld()) return shuttle(direction);
    if (!canUsePlaybackOrTimelineFocus()) return false;
    if (hasActivePreviewPlaybackTarget()) {
      if (direction === 'forward') {
        uiStore.triggerPreviewPlayback('step', undefined, undefined, getPlaybackStepSeconds(1));
      }
      return true;
    }

    const fps = timelineStore.timelineDoc ? getDocFps(timelineStore.timelineDoc) : 30;
    playbackStepHoldRunner.startHold({
      keyCode: e.code,
      intervalMs: 3000 / fps,
      action: () => {
        timelineStore.seekFrames(direction === 'forward' ? 1 : -1);
      },
    });
    return true;
  }

  const playbackSpeedMap: Partial<
    Record<
      HotkeyCommandId,
      {
        direction: 'forward' | 'backward';
        speed: number;
      }
    >
  > = {
    'playback.forward0_5': { direction: 'forward', speed: 0.5 },
    'playback.backward0_5': { direction: 'backward', speed: 0.5 },
    'playback.forward0_75': { direction: 'forward', speed: 0.75 },
    'playback.backward0_75': { direction: 'backward', speed: 0.75 },
    'playback.forward1_25': { direction: 'forward', speed: 1.25 },
    'playback.backward1_25': { direction: 'backward', speed: 1.25 },
    'playback.forward1_5': { direction: 'forward', speed: 1.5 },
    'playback.backward1_5': { direction: 'backward', speed: 1.5 },
    'playback.forward1_75': { direction: 'forward', speed: 1.75 },
    'playback.backward1_75': { direction: 'backward', speed: 1.75 },
    'playback.forward2': { direction: 'forward', speed: 2 },
    'playback.backward2': { direction: 'backward', speed: 2 },
    'playback.forward3': { direction: 'forward', speed: 3 },
    'playback.backward3': { direction: 'backward', speed: 3 },
    'playback.forward5': { direction: 'forward', speed: 5 },
    'playback.backward5': { direction: 'backward', speed: 5 },
  };

  function setTimelinePlayback(params: { direction: 'forward' | 'backward'; speed: number }) {
    const finalSpeed = params.direction === 'backward' ? -params.speed : params.speed;

    if (timelineStore.isPlaying && timelineStore.playbackSpeed === finalSpeed) {
      timelineStore.setPlaybackSpeed(params.direction === 'backward' ? -1 : 1);
      return;
    }

    timelineStore.setPlaybackSpeed(finalSpeed);
    if (!timelineStore.isPlaying) {
      timelineStore.togglePlayback();
    }
  }

  for (const [cmd, speedCmd] of Object.entries(playbackSpeedMap)) {
    handlers[cmd as HotkeyCommandId] = () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;

      if (hasActivePreviewPlaybackTarget()) {
        if (speedCmd.direction === 'backward') {
          return true; // ignored but consumed
        }
        uiStore.triggerPreviewPlayback('set', speedCmd.speed, speedCmd.direction);
        return true;
      }

      setTimelinePlayback(speedCmd);
      return true;
    };
  }

  return handlers;
}
