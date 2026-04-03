import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFps } from '~/timeline/commands/utils';

import type { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

const AUDIO_MIXER_GAIN_STEP = 0.05;

export function useTimelineHotkeys(
  navigationHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
) {
  const timelineStore = useTimelineStore();
  const settingsStore = useTimelineSettingsStore();
  const focusStore = useFocusStore();
  const workspaceStore = useWorkspaceStore();
  const clipboardStore = useAppClipboard();

  function getTargetTrackId() {
    return timelineStore.getSelectedOrActiveTrackId();
  }

  function adjustAudioMixerGain(delta: number) {
    if (focusStore.effectiveFocus !== 'audioMixer') return false;

    const trackId = timelineStore.selectedTrackId;
    if (trackId) {
      const track = timelineStore.timelineDoc?.tracks.find((item) => item.id === trackId);
      if (!track) return false;
      const nextGain = Math.max(0, Number(track.audioGain ?? 1) + delta);
      timelineStore.updateTrackProperties(trackId, { audioGain: nextGain });
      return true;
    }

    const nextMasterGain = Math.max(0, Number(timelineStore.masterGain ?? 1) + delta);
    timelineStore.setMasterGain(nextMasterGain);
    return true;
  }

  function toggleAudioMixerMute() {
    if (focusStore.effectiveFocus !== 'audioMixer') return false;

    const trackId = timelineStore.selectedTrackId;
    if (trackId) {
      timelineStore.toggleTrackAudioMuted(trackId);
      return true;
    }

    timelineStore.setMasterMuted(!timelineStore.audioMuted);
    return true;
  }

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'timeline.toggleSnap': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.toggleToolbarSnapMode();
      return true;
    },

    'general.copy': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      clipboardStore.setClipboardPayload({
        source: 'timeline',
        operation: 'copy',
        items: timelineStore.copySelectedClips().map((item) => ({
          sourceTrackId: item.sourceTrackId,
          clip: item.clip,
        })),
      });

      return true;
    },

    'general.cut': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      clipboardStore.setClipboardPayload({
        source: 'timeline',
        operation: 'cut',
        items: timelineStore.cutSelectedClips().map((item) => ({
          sourceTrackId: item.sourceTrackId,
          clip: item.clip,
        })),
      });

      return true;
    },

    'general.paste': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;

      const payload = clipboardStore.clipboardPayload;
      if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return false;

      timelineStore.pasteClips(payload.items, {
        targetTrackId: timelineStore.getSelectedOrActiveTrackId(),
      });

      if (payload.operation === 'cut') {
        clipboardStore.setClipboardPayload(null);
      }

      return true;
    },

    'timeline.duplicate': () => {
      void timelineStore.duplicateCurrentTimeline();
      return true;
    },

    'timeline.selectClipsLeftOfPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.selectClipsRelativeToPlayhead({
        direction: 'left',
        trackId: getTargetTrackId(),
      });
      return true;
    },

    'timeline.selectClipsRightOfPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.selectClipsRelativeToPlayhead({
        direction: 'right',
        trackId: getTargetTrackId(),
      });
      return true;
    },

    'timeline.trimToPlayheadLeft': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.trimToPlayheadLeftNoRipple();
      return true;
    },

    'timeline.trimToPlayheadRight': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.trimToPlayheadRightNoRipple();
      return true;
    },

    'timeline.rippleTrimLeft': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.rippleTrimLeft();
      return true;
    },

    'timeline.rippleTrimRight': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.rippleTrimRight();
      return true;
    },

    'timeline.advancedRippleTrimLeft': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.advancedRippleTrimLeft();
      return true;
    },

    'timeline.advancedRippleTrimRight': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.advancedRippleTrimRight();
      return true;
    },

    'timeline.rippleDelete': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;

      if (timelineStore.getSelectionRange()) {
        timelineStore.removeSelectionRange();
        return true;
      }

      timelineStore.rippleDeleteFirstSelectedItem();
      return true;
    },

    'timeline.jumpPrevBoundary': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.jumpToPrevClipBoundary();
      return true;
    },

    'timeline.jumpNextBoundary': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.jumpToNextClipBoundary();
      return true;
    },

    'timeline.jumpPrevBoundaryTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.jumpToPrevClipBoundary({ currentTrackOnly: true });
      return true;
    },

    'timeline.jumpNextBoundaryTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.jumpToNextClipBoundary({ currentTrackOnly: true });
      return true;
    },

    'timeline.splitAtPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.splitClipAtPlayhead();
      return true;
    },

    'timeline.splitAllAtPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.splitAllClipsAtPlayhead();
      return true;
    },

    'timeline.toggleDisableClip': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.toggleDisableTargetClip();
      return true;
    },

    'timeline.toggleMuteClip': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (toggleAudioMixerMute()) return true;
      void timelineStore.toggleMuteTargetClip();
      return true;
    },

    'timeline.toggleVisibilityTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.toggleVisibilityTargetTrack();
      return true;
    },

    'timeline.toggleMuteTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.toggleMuteTargetTrack();
      return true;
    },

    'timeline.toggleSoloTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.toggleSoloTargetTrack();
      return true;
    },

    'timeline.moveSelectedClipsLeft': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.moveSelectedClips(-1);
        },
      });
      return true;
    },

    'timeline.moveSelectedClipsRight': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          timelineStore.moveSelectedClips(1);
        },
      });
      return true;
    },

    'timeline.moveSelectedClipsLeftLarge': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
          timelineStore.moveSelectedClips(-fps);
        },
      });
      return true;
    },

    'timeline.moveSelectedClipsRightLarge': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
          timelineStore.moveSelectedClips(fps);
        },
      });
      return true;
    },

    'timeline.increaseSelectedClipsVolume': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          if (adjustAudioMixerGain(AUDIO_MIXER_GAIN_STEP)) return;
          timelineStore.adjustSelectedClipsVolume(1);
        },
      });
      return true;
    },

    'timeline.decreaseSelectedClipsVolume': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          if (adjustAudioMixerGain(-AUDIO_MIXER_GAIN_STEP)) return;
          timelineStore.adjustSelectedClipsVolume(-1);
        },
      });
      return true;
    },

    'timeline.setSelectionIn': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const currentRange = timelineStore.getSelectionRange();
      const currentUs = timelineStore.currentTime;

      if (!currentRange) {
        // No range exists, create a new one with default duration
        const endUs = currentUs + workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
        timelineStore.createSelectionRange({
          startUs: currentUs,
          endUs: endUs,
        });
      } else {
        // Range exists, update the in point (startUs)
        // If currentUs is greater than endUs, we can't make start > end, so we bring end along or just set it
        const nextStartUs = currentUs;
        const nextEndUs = Math.max(currentRange.endUs, currentUs + 1);
        timelineStore.updateSelectionRange({
          startUs: nextStartUs,
          endUs: nextEndUs,
        });
      }
      return true;
    },

    'timeline.setSelectionOut': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const currentRange = timelineStore.getSelectionRange();
      const currentUs = timelineStore.currentTime;

      if (!currentRange) {
        // No range exists, create a new one ending at playhead and starting before it based on default duration
        const startUs = Math.max(
          0,
          currentUs - workspaceStore.userSettings.timeline.defaultStaticClipDurationUs,
        );
        timelineStore.createSelectionRange({
          startUs: startUs,
          endUs: currentUs,
        });
      } else {
        // Range exists, update the out point (endUs)
        const nextEndUs = currentUs;
        const nextStartUs = Math.min(currentRange.startUs, currentUs - 1);
        timelineStore.updateSelectionRange({
          startUs: nextStartUs,
          endUs: nextEndUs,
        });
      }
      return true;
    },
  };

  return handlers;
}
