import type { ComputedRef } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { HotkeyCommandId, HotkeyCombo } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFpsOrDefault } from '~/timeline/commands/utils';
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
  const selectionStore = useSelectionStore();
  function canUsePlaybackOrTimelineFocus() {
    return focusStore.canUsePlaybackHotkeys || focusStore.effectiveFocus === 'timeline';
  }

  function isTimelinePropertiesFocus() {
    return focusStore.isPropertiesFocus && selectionStore.selectedEntity?.source === 'timeline';
  }

  function shouldBlockTimelineStepInPreviewFocus() {
    return isPreviewLikeFocus(focusStore.effectiveFocus) && !isTimelinePropertiesFocus();
  }

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'playback.toggle': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      timelineStore.togglePlayback();
      return true;
    },

    'playback.toggle1': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      timelineStore.setPlaybackSpeed(1);
      timelineStore.togglePlayback();
      return true;
    },

    'playback.play1ResetSpeed': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      timelineStore.setPlaybackSpeed(1);
      if (!timelineStore.isPlaying) {
        timelineStore.togglePlayback();
      }
      return true;
    },

    'timeline.globalToStart': () => {
      timelineStore.goToStart();
      return true;
    },

    'timeline.globalToEnd': () => {
      timelineStore.goToEnd();
      return true;
    },

    'playback.stepForward': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (shouldBlockTimelineStepInPreviewFocus()) return false;

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
      if (shouldBlockTimelineStepInPreviewFocus()) return false;

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
      if (shouldBlockTimelineStepInPreviewFocus()) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFpsOrDefault(timelineStore.timelineDoc);
          timelineStore.seekFrames(fps);
        },
      });
      return true;
    },

    'playback.stepBackwardLarge': (e) => {
      if (!canUsePlaybackOrTimelineFocus()) return false;
      if (shouldBlockTimelineStepInPreviewFocus()) return false;

      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFpsOrDefault(timelineStore.timelineDoc);
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
      if (timelineStore.isPlaying) timelineStore.togglePlayback();
      timelineStore.setPlaybackSpeed(1);
      return true;
    },
  };

  function shuttle(direction: ShuttleDirection): boolean {
    if (!canUsePlaybackOrTimelineFocus()) return false;
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
    const fps = getDocFpsOrDefault(timelineStore.timelineDoc);
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

      setTimelinePlayback(speedCmd);
      return true;
    };
  }

  return handlers;
}
