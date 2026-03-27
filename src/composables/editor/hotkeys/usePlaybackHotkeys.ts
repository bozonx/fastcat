import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useUiStore } from '~/stores/ui.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFps } from '~/timeline/commands/utils';
import { isPreviewLikeFocus } from '~/utils/hotkeys/runtime';

import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

export function usePlaybackHotkeys(
  playbackStepHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
) {
  const timelineStore = useTimelineStore();
  const focusStore = useFocusStore();
  const uiStore = useUiStore();

  function canUsePlaybackOrTimelineFocus() {
    return focusStore.canUsePlaybackHotkeys || focusStore.effectiveFocus === 'timeline';
  }

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'playback.toggle': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      if (isPreviewLikeFocus(focusStore.effectiveFocus)) {
        uiStore.triggerPreviewPlayback('toggle');
        return true;
      }

      timelineStore.togglePlayback();
      return true;
    },

    'playback.toggle1': () => {
      if (!canUsePlaybackOrTimelineFocus()) return false;

      if (isPreviewLikeFocus(focusStore.effectiveFocus)) {
        uiStore.triggerPreviewPlayback('toggle1');
        return true;
      }

      if (timelineStore.isPlaying) {
        timelineStore.setPlaybackSpeed(1);
        return true;
      }

      timelineStore.setPlaybackSpeed(1);
      timelineStore.togglePlayback();
      return true;
    },

    'playback.toStart': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;

      if (isPreviewLikeFocus(focusStore.effectiveFocus)) {
        uiStore.triggerPreviewPlayback('toStart');
        return true;
      }

      timelineStore.goToStart();
      return true;
    },

    'playback.toEnd': () => {
      if (!focusStore.canUsePlaybackHotkeys) return false;

      if (isPreviewLikeFocus(focusStore.effectiveFocus)) {
        uiStore.triggerPreviewPlayback('toEnd');
        return true;
      }

      timelineStore.goToEnd();
      return true;
    },

    'playback.stepForward': (e) => {
      if (!canUsePlaybackOrTimelineFocus() || isPreviewLikeFocus(focusStore.effectiveFocus)) return false;
      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.seekFrames(1);
        },
      });
      return true;
    },

    'playback.stepBackward': (e) => {
      if (!canUsePlaybackOrTimelineFocus() || isPreviewLikeFocus(focusStore.effectiveFocus)) return false;
      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.seekFrames(-1);
        },
      });
      return true;
    },

    'playback.stepForwardLarge': (e) => {
      if (!canUsePlaybackOrTimelineFocus() || isPreviewLikeFocus(focusStore.effectiveFocus)) return false;
      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
          timelineStore.seekFrames(fps);
        },
      });
      return true;
    },

    'playback.stepBackwardLarge': (e) => {
      if (!canUsePlaybackOrTimelineFocus() || isPreviewLikeFocus(focusStore.effectiveFocus)) return false;
      playbackStepHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
          timelineStore.seekFrames(-fps);
        },
      });
      return true;
    },
  };

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
    'playback.backward1': { direction: 'backward', speed: 1 },
  };

  function setTimelinePlayback(params: { direction: 'forward' | 'backward'; speed: number }) {
    const finalSpeed = params.direction === 'backward' ? -params.speed : params.speed;

    if (timelineStore.isPlaying && timelineStore.playbackSpeed === finalSpeed) {
      timelineStore.togglePlayback();
      return;
    }

    timelineStore.setPlaybackSpeed(finalSpeed);
    if (!timelineStore.isPlaying) {
      timelineStore.togglePlayback();
    }
  }

  function forceTimelinePlaybackSpeed(params: {
    direction: 'forward' | 'backward';
    speed: number;
  }) {
    const finalSpeed = params.direction === 'backward' ? -params.speed : params.speed;
    timelineStore.setPlaybackSpeed(finalSpeed);
    if (!timelineStore.isPlaying) {
      timelineStore.togglePlayback();
    }
  }

  for (const [cmd, speedCmd] of Object.entries(playbackSpeedMap)) {
    handlers[cmd as HotkeyCommandId] = () => {
      const canUse = focusStore.canUsePlaybackHotkeys;
      if (!canUse) return false;

      if (isPreviewLikeFocus(focusStore.effectiveFocus)) {
        if (speedCmd.direction === 'backward') {
          return true; // ignored but consumed
        }
        uiStore.triggerPreviewPlayback('set', speedCmd.speed, speedCmd.direction);
        return true;
      }

      if (cmd === 'playback.backward1') {
        forceTimelinePlaybackSpeed(speedCmd);
      } else {
        setTimelinePlayback(speedCmd);
      }
      return true;
    };
  }

  return handlers;
}
