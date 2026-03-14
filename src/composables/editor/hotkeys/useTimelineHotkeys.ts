import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { useFocusStore } from '~/stores/focus.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFps } from '~/timeline/commands/utils';

const AUDIO_MIXER_GAIN_STEP = 0.05;

export function useTimelineHotkeys() {
  const timelineStore = useTimelineStore();
  const settingsStore = useTimelineSettingsStore();
  const focusStore = useFocusStore();

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

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'timeline.toggleSnap': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const next = settingsStore.clipSnapMode === 'none' ? 'clips' : 'none';
      settingsStore.setClipSnapMode(next);
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

    'timeline.moveSelectedClipsLeft': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      timelineStore.moveSelectedClips(-1);
      return true;
    },

    'timeline.moveSelectedClipsRight': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      timelineStore.moveSelectedClips(1);
      return true;
    },

    'timeline.moveSelectedClipsLeftLarge': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      // Move by 1 second (approx)
      const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
      timelineStore.moveSelectedClips(-fps);
      return true;
    },

    'timeline.moveSelectedClipsRightLarge': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;
      // Move by 1 second (approx)
      const fps = getDocFps(timelineStore.timelineDoc || ({} as any));
      timelineStore.moveSelectedClips(fps);
      return true;
    },

    'timeline.increaseSelectedClipsVolume': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (adjustAudioMixerGain(AUDIO_MIXER_GAIN_STEP)) return true;
      timelineStore.adjustSelectedClipsVolume(1);
      return true;
    },

    'timeline.decreaseSelectedClipsVolume': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (adjustAudioMixerGain(-AUDIO_MIXER_GAIN_STEP)) return true;
      timelineStore.adjustSelectedClipsVolume(-1);
      return true;
    },
  };

  return handlers;
}
