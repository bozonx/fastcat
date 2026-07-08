import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getDocFps } from '~/timeline/commands/utils';
import type { TimelineClipItem } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { createClipParametersSnapshot } from '~/utils/timeline/clip-parameters';
import { createLinkedGroupId } from '~/timeline/id';
import type { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import {
  clipSupportsThumbnailControls,
  clipSupportsWaveformControls,
  getSelectedClipRefs,
  clipSupportsSpeedControls,
} from '~/utils/timeline/clip-capabilities';

const AUDIO_MIXER_GAIN_STEP = 0.05;
const AUDIO_MIXER_GAIN_MAX = 2;

export function useTimelineHotkeys(
  navigationHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
) {
  const timelineStore = useTimelineStore();
  const settingsStore = useTimelineSettingsStore();
  const focusStore = useFocusStore();
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
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
      const nextGain = Math.max(
        0,
        Math.min(AUDIO_MIXER_GAIN_MAX, Number(track.audioGain ?? 1) + delta),
      );
      timelineStore.updateTrackProperties(trackId, { audioGain: nextGain });
      return true;
    }

    const nextMasterGain = Math.max(
      0,
      Math.min(AUDIO_MIXER_GAIN_MAX, Number(timelineStore.masterGain ?? 1) + delta),
    );
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
    'timeline.addTextClipAtPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.addTextClipAtPlayhead();
      return true;
    },

    'timeline.addBackgroundClipAtPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.addBackgroundClipAtPlayhead();
      return true;
    },

    'timeline.addAdjustmentClipAtPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.addAdjustmentClipAtPlayhead();
      return true;
    },

    'timeline.selectSnapModeSnap': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.selectToolbarSnapMode('snap');
      return true;
    },

    'timeline.selectSnapModeNoSnap': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.selectToolbarSnapMode('no_snap');
      return true;
    },

    'timeline.selectSnapModeFree': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.selectToolbarSnapMode('free_mode');
      return true;
    },

    'timeline.selectDragModeMove': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.toolbarDragModeEnabled = false;
      return true;
    },

    'timeline.selectDragModePseudoOverlap': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.selectToolbarDragMode('pseudo_overlap');
      return true;
    },

    'timeline.selectDragModeSlip': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      settingsStore.selectToolbarDragMode('slip');
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

      // For cut+paste, hold the clipboard until the paste resolves so a failed
      // paste does not leave the user with deleted clips and no way to retry.
      // Successful paste of a cut: clipboard is cleared once.
      void timelineStore
        .pasteClips(payload.items, {
          targetTrackId: timelineStore.getSelectedOrActiveTrackId(),
          respectToolbarModes: true,
        })
        .then((res) => {
          if (payload.operation === 'cut' && res.length > 0) {
            clipboardStore.setClipboardPayload(null);
          }
        });

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

    'timeline.rippleDeleteSelectedClipRange': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.rippleDeleteSelectedClipRangeAllTracks();
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
          const fps = getDocFps(
            (timelineStore.timelineDoc ||
              ({} as { format?: { fps?: number } })) as import('~/timeline/types').TimelineDocument,
          );
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
          const fps = getDocFps(
            (timelineStore.timelineDoc ||
              ({} as { format?: { fps?: number } })) as import('~/timeline/types').TimelineDocument,
          );
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
          timelineStore.adjustSelectedClipsVolume(0.01);
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
          timelineStore.adjustSelectedClipsVolume(-0.01);
        },
      });
      return true;
    },

    'timeline.increaseSelectedClipsVolumeLarge': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          if (adjustAudioMixerGain(AUDIO_MIXER_GAIN_STEP * 5)) return;
          timelineStore.adjustSelectedClipsVolume(0.05);
        },
      });
      return true;
    },

    'timeline.decreaseSelectedClipsVolumeLarge': (e) => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      navigationHoldRunner.startHold({
        keyCode: e.code,
        action: () => {
          if (adjustAudioMixerGain(-AUDIO_MIXER_GAIN_STEP * 5)) return;
          timelineStore.adjustSelectedClipsVolume(-0.05);
        },
      });
      return true;
    },

    'timeline.copyClipParameters': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length !== 1) return false;
      const itemId = timelineStore.selectedItemIds[0];
      const doc = timelineStore.timelineDoc;
      if (doc) {
        for (const track of doc.tracks) {
          const clip = track.items.find((it) => it.id === itemId && it.kind === 'clip') as
            | TimelineClipItem
            | undefined;
          if (clip) {
            clipboardStore.setClipboardPayload({
              source: 'clipParameters',
              snapshot: createClipParametersSnapshot({ clip, trackKind: track.kind }),
            });
            return true;
          }
        }
      }
      return false;
    },

    'timeline.pasteClipParameters': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length !== 1) return false;

      const payload = clipboardStore.clipboardPayload;
      if (!payload || payload.source !== 'clipParameters') return false;

      const itemId = timelineStore.selectedItemIds[0];
      const doc = timelineStore.timelineDoc;
      if (doc) {
        for (const track of doc.tracks) {
          const clip = track.items.find((it) => it.id === itemId && it.kind === 'clip') as
            | TimelineClipItem
            | undefined;
          if (clip) {
            uiStore.triggerClipPasteParameters(track.id, clip.id);
            return true;
          }
        }
      }
      return false;
    },

    'timeline.toggleWaveformMode': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const targets = getSelectedClipRefs(
        doc,
        timelineStore.selectedItemIds.map((itemId) => ({ trackId: '', itemId })),
      ).filter(({ track, clip }) => clipSupportsWaveformControls(track, clip));
      if (targets.length === 0) return false;

      const currentMode = targets[0]?.clip.audioWaveformMode || 'half';
      const nextMode: 'full' | 'half' = currentMode === 'half' ? 'full' : 'half';

      const cmds: TimelineCommand[] = targets.map(({ track, clip }) => ({
        type: 'update_clip_properties' as const,
        trackId: track.id,
        itemId: clip.id,
        properties: { audioWaveformMode: nextMode },
      }));
      timelineStore.batchApplyTimeline(cmds);
      void timelineStore.requestTimelineSave({ immediate: true });
      return true;
    },

    'timeline.toggleShowWaveform': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const targets = getSelectedClipRefs(
        doc,
        timelineStore.selectedItemIds.map((itemId) => ({ trackId: '', itemId })),
      ).filter(({ track, clip }) => clipSupportsWaveformControls(track, clip));
      if (targets.length === 0) return false;

      const currentShow = targets[0]?.clip.showWaveform !== false;
      const nextShow = !currentShow;

      const cmds = targets.map(({ track, clip }) => ({
        type: 'update_clip_properties' as const,
        trackId: track.id,
        itemId: clip.id,
        properties: { showWaveform: nextShow },
      }));
      timelineStore.batchApplyTimeline(cmds);
      void timelineStore.requestTimelineSave({ immediate: true });
      return true;
    },

    'timeline.toggleShowThumbnails': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const targets = getSelectedClipRefs(
        doc,
        timelineStore.selectedItemIds.map((itemId) => ({ trackId: '', itemId })),
      ).filter(({ track, clip }) => clipSupportsThumbnailControls(track, clip));
      if (targets.length === 0) return false;

      const currentShow = targets[0]?.clip.showThumbnails !== false;
      const nextShow = !currentShow;

      const cmds = targets.map(({ track, clip }) => ({
        type: 'update_clip_properties' as const,
        trackId: track.id,
        itemId: clip.id,
        properties: { showThumbnails: nextShow },
      }));
      timelineStore.batchApplyTimeline(cmds);
      void timelineStore.requestTimelineSave({ immediate: true });
      return true;
    },

    'timeline.toggleFreezeFrame': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length !== 1) return false;

      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const itemId = timelineStore.selectedItemIds[0];
      for (const track of doc.tracks) {
        const item = track.items.find((it) => it.id === itemId && it.kind === 'clip');
        if (item && item.kind === 'clip' && item.clipType === 'media') {
          if (typeof item.freezeFrameSourceUs === 'number') {
            timelineStore.resetClipFreezeFrame({ trackId: track.id, itemId: item.id });
          } else {
            const playheadUs = timelineStore.currentTime;
            const clipStartUs = item.timelineRange.startUs;
            const clipEndUs = clipStartUs + item.timelineRange.durationUs;
            if (playheadUs >= clipStartUs && playheadUs < clipEndUs) {
              timelineStore.setClipFreezeFrameFromPlayhead({ trackId: track.id, itemId: item.id });
            }
          }
          return true;
        }
      }
      return false;
    },

    'timeline.toggleLockClip': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      if (timelineStore.selectedItemIds.length === 0) return false;

      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const selectedSet = new Set(timelineStore.selectedItemIds);
      let currentLocked = false;
      for (const track of doc.tracks) {
        for (const item of track.items) {
          if (selectedSet.has(item.id) && item.kind === 'clip') {
            currentLocked = Boolean(item.locked);
            break;
          }
        }
        if (currentLocked) break;
      }

      const nextLocked = !currentLocked;

      const cmds: TimelineCommand[] = [];
      for (const track of doc.tracks) {
        for (const item of track.items) {
          if (selectedSet.has(item.id) && item.kind === 'clip') {
            cmds.push({
              type: 'update_clip_properties',
              trackId: track.id,
              itemId: item.id,
              properties: { locked: nextLocked },
            });
          }
        }
      }

      if (cmds.length > 0) {
        timelineStore.batchApplyTimeline(cmds);
      }
      void timelineStore.requestTimelineSave({ immediate: true });
      return true;
    },

    'timeline.toggleLockTrack': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      void timelineStore.toggleLockTargetTrack();
      return true;
    },

    'timeline.setSelectionIn': () => {
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

    'timeline.centerPlayhead': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.requestScrollToPlayhead();
      return true;
    },

    'timeline.toggleBladeTool': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      timelineStore.isTrimModeActive = !timelineStore.isTrimModeActive;
      return true;
    },

    'timeline.reverseSpeed': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const targets = getSelectedClipRefs(
        doc,
        timelineStore.selectedItemIds.map((itemId) => ({ trackId: '', itemId })),
      ).filter(
        ({ track, clip }) =>
          clipSupportsSpeedControls(track, clip) && typeof clip.freezeFrameSourceUs !== 'number',
      );

      if (targets.length === 0) return false;

      const cmds: TimelineCommand[] = targets.map(({ track, clip }) => {
        const currentSpeed = typeof clip.speed === 'number' ? clip.speed : 1;
        return {
          type: 'update_clip_properties' as const,
          trackId: track.id,
          itemId: clip.id,
          properties: { speed: -currentSpeed },
        };
      });

      timelineStore.batchApplyTimeline(cmds);
      void timelineStore.requestTimelineSave({ immediate: true });
      return true;
    },

    'timeline.openSpeedModal': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const doc = timelineStore.timelineDoc;
      if (!doc) return false;

      const targets = getSelectedClipRefs(
        doc,
        timelineStore.selectedItemIds.map((itemId) => ({ trackId: '', itemId })),
      ).filter(
        ({ track, clip }) =>
          clipSupportsSpeedControls(track, clip) && typeof clip.freezeFrameSourceUs !== 'number',
      );

      if (targets.length === 0) return false;

      const { track, clip } = targets[0]!;
      const currentSpeed = clip.speed ?? 1;

      uiStore.triggerSpeedModal(track.id, clip.id, currentSpeed);
      return true;
    },

    'timeline.groupClips': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const clips = getSelectedClips();
      if (clips.length < 2) return false;

      const nextGroupId = createLinkedGroupId();
      const cmds: TimelineCommand[] = clips.map(({ trackId, itemId }) => ({
        type: 'update_clip_properties',
        trackId,
        itemId,
        properties: {
          linkedGroupId: nextGroupId,
        },
      }));

      timelineStore.batchApplyTimeline(cmds, {
        labelKey: 'videoEditor.fileManager.history.entries.groupClips',
      });
      return true;
    },

    'timeline.ungroupClips': () => {
      if (!focusStore.canUseTimelineHotkeys) return false;
      const clips = getSelectedClips();
      if (clips.length === 0) return false;

      const cmds: TimelineCommand[] = clips.map(({ trackId, itemId }) => ({
        type: 'update_clip_properties',
        trackId,
        itemId,
        properties: {
          linkedGroupId: undefined,
        },
      }));

      timelineStore.batchApplyTimeline(cmds, {
        labelKey: 'videoEditor.fileManager.history.entries.ungroupClips',
      });
      return true;
    },
  };

  function getSelectedClips(): { trackId: string; itemId: string }[] {
    const entity = selectionStore.selectedEntity;
    if (!entity || entity.source !== 'timeline') return [];
    if (entity.kind === 'clips') {
      return entity.items;
    }
    if (entity.kind === 'clip') {
      return [{ trackId: entity.trackId, itemId: entity.itemId }];
    }
    return [];
  }

  return handlers;
}
