import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

export function useTimelineHotkeys() {
  const timelineStore = useTimelineStore();
  const focusStore = useFocusStore();

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
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
  };

  return handlers;
}
