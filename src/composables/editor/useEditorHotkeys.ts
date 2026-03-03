import { onMounted, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

export function useEditorHotkeys() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const selectionStore = useSelectionStore();
  const { loadTimeline } = useProjectActions();

  const volumeHoldRunner = createHotkeyHoldRunner();
  const zoomHoldRunner = createHotkeyHoldRunner();

  const suppressedKeyupCodes = new Set<string>();

  function startVolumeHotkeyHold(params: { step: number; keyCode: string }) {
    volumeHoldRunner.startHold({
      keyCode: params.keyCode,
      action: () => {
        timelineStore.setAudioVolume(timelineStore.audioVolume + params.step);
      },
    });
  }

  function startZoomHotkeyHold(params: { step: number; keyCode: string }) {
    zoomHoldRunner.startHold({
      keyCode: params.keyCode,
      action: () => {
        timelineStore.setTimelineZoom(timelineStore.timelineZoom + params.step);
      },
    });
  }

  function dispatchPreviewPlayback(
    detail:
      | { action: 'toggle' }
      | { action: 'toStart' }
      | { action: 'toEnd' }
      | { action: 'set'; direction: 'forward' | 'backward'; speed: number },
  ) {
    window.dispatchEvent(new CustomEvent('gran-preview-playback', { detail }));
  }

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

  async function onGlobalKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.repeat) return;

    if (document.querySelector('[role="dialog"]')) return;

    if (e.key === 'Tab' && focusStore.tempFocus !== 'none') {
      e.preventDefault();
      focusStore.handleFocusHotkey();
      return;
    }

    if (isEditableTarget(e.target)) return;
    if (isEditableTarget(document.activeElement)) return;

    const combo = hotkeyFromKeyboardEvent(e);
    if (!combo) return;

    const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);

    const cmdOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
    const matched: HotkeyCommandId[] = [];
    for (const cmdId of cmdOrder) {
      const bindings = effective[cmdId];
      if (bindings.includes(combo)) {
        matched.push(cmdId);
      }
    }
    if (matched.length === 0) return;

    const focusAware = (() => {
      const order: HotkeyCommandId[] = [];

      const timeline = matched.filter((c) => c.startsWith('timeline.'));
      const playback = matched.filter((c) => c.startsWith('playback.'));
      const general = matched.filter((c) => c.startsWith('general.'));

      if (focusStore.canUseTimelineHotkeys) {
        order.push(...timeline, ...general, ...playback);
      } else if (focusStore.canUsePlaybackHotkeys) {
        order.push(...playback, ...general, ...timeline);
      } else {
        order.push(...general, ...timeline, ...playback);
      }

      return order[0] ?? matched[0]!;
    })();

    if (document.activeElement instanceof HTMLElement) {
      if (!isEditableTarget(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.();
    suppressedKeyupCodes.add(e.code);

    const cmd: string = focusAware;
    if (cmd === 'general.focus') {
      focusStore.handleFocusHotkey();
      return;
    }

    if (cmd === 'general.undo') {
      timelineStore.undoTimeline();
      return;
    }

    if (cmd === 'general.redo') {
      timelineStore.redoTimeline();
      return;
    }

    if (cmd === 'general.delete') {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        uiStore.pendingFsEntryDelete = selected.entry;
      } else if (selected?.source === 'timeline') {
        if (selected.kind === 'track') {
          timelineStore.deleteTrack(selected.trackId, { allowNonEmpty: true });
          selectionStore.clearSelection();
        } else {
          timelineStore.deleteFirstSelectedItem();
        }
      } else if (timelineStore.selectedItemIds.length > 0) {
        timelineStore.deleteFirstSelectedItem();
      }
      return;
    }

    if (cmd === 'general.deselect') {
      selectionStore.clearSelection();
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
      return;
    }

    if (cmd === 'timeline.rippleDelete') {
      if (!focusStore.canUseTimelineHotkeys) return;
      timelineStore.rippleDeleteFirstSelectedItem();
      return;
    }

    if (cmd === 'general.fullscreen') {
      const { useEditorViewStore } = await import('~/stores/editorView.store');
      const viewStore = useEditorViewStore();

      // Check if we are in monitor fullscreen mode
      if (viewStore.currentView === 'fullscreen') {
        viewStore.goToCut();
        return;
      }

      if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        const entity = selectionStore.selectedEntity;
        if (entity?.source === 'fileManager' && entity.kind === 'file') {
          // Send event to toggle modal in FileProperties / FilePreview
          window.dispatchEvent(new CustomEvent('gran-preview-fullscreen-toggle'));
          return;
        }
      }

      viewStore.goToFullscreen();
      return;
    }

    if (cmd === 'general.zoomIn') {
      // Zoom logic depends on focus
      if (focusStore.effectiveFocus === 'timeline') {
        startZoomHotkeyHold({ step: 3, keyCode: e.code });
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        window.dispatchEvent(
          new CustomEvent('gran-zoom', { detail: { dir: 1, target: 'preview' } }),
        );
      } else if (focusStore.effectiveFocus === 'monitor') {
        window.dispatchEvent(
          new CustomEvent('gran-zoom', { detail: { dir: 1, target: 'monitor' } }),
        );
      }
      return;
    }

    if (cmd === 'general.zoomOut') {
      if (focusStore.effectiveFocus === 'timeline') {
        startZoomHotkeyHold({ step: -3, keyCode: e.code });
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        window.dispatchEvent(
          new CustomEvent('gran-zoom', { detail: { dir: -1, target: 'preview' } }),
        );
      } else if (focusStore.effectiveFocus === 'monitor') {
        window.dispatchEvent(
          new CustomEvent('gran-zoom', { detail: { dir: -1, target: 'monitor' } }),
        );
      }
      return;
    }

    if (cmd === 'general.zoomReset') {
      if (focusStore.effectiveFocus === 'timeline') {
        timelineStore.setTimelineZoom(50);
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        window.dispatchEvent(new CustomEvent('gran-zoom-reset', { detail: { target: 'preview' } }));
      } else if (focusStore.effectiveFocus === 'monitor') {
        window.dispatchEvent(new CustomEvent('gran-zoom-reset', { detail: { target: 'monitor' } }));
      }
      return;
    }

    // --- Timeline Tabs ---
    if (cmd.startsWith('general.tab')) {
      const tabIndexStr = cmd.replace('general.tab', '');
      const tabIndex = parseInt(tabIndexStr, 10);
      if (!isNaN(tabIndex)) {
        const openPaths = projectStore.projectSettings.timelines.openPaths;
        if (tabIndex > 0 && tabIndex <= openPaths.length) {
          const path = openPaths[tabIndex - 1];
          if (path) {
            void loadTimeline(path);
          }
        }
      }
      return;
    }

    if (cmd === 'timeline.trimToPlayheadLeft') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.trimToPlayheadLeftNoRipple();
      return;
    }

    if (cmd === 'timeline.trimToPlayheadRight') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.trimToPlayheadRightNoRipple();
      return;
    }

    if (cmd === 'timeline.rippleTrimLeft') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.rippleTrimLeft();
      return;
    }

    if (cmd === 'timeline.rippleTrimRight') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.rippleTrimRight();
      return;
    }

    if (cmd === 'timeline.advancedRippleTrimLeft') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.advancedRippleTrimLeft();
      return;
    }

    if (cmd === 'timeline.advancedRippleTrimRight') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.advancedRippleTrimRight();
      return;
    }

    if (cmd === 'timeline.jumpPrevBoundary') {
      if (!focusStore.canUseTimelineHotkeys) return;
      timelineStore.jumpToPrevClipBoundary();
      return;
    }

    if (cmd === 'timeline.jumpNextBoundary') {
      if (!focusStore.canUseTimelineHotkeys) return;
      timelineStore.jumpToNextClipBoundary();
      return;
    }

    if (cmd === 'timeline.jumpPrevBoundaryTrack') {
      if (!focusStore.canUseTimelineHotkeys) return;
      timelineStore.jumpToPrevClipBoundary({ currentTrackOnly: true });
      return;
    }

    if (cmd === 'timeline.jumpNextBoundaryTrack') {
      if (!focusStore.canUseTimelineHotkeys) return;
      timelineStore.jumpToNextClipBoundary({ currentTrackOnly: true });
      return;
    }

    if (cmd === 'timeline.splitAtPlayhead') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.splitClipAtPlayhead();
      return;
    }

    if (cmd === 'timeline.splitAllAtPlayhead') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.splitAllClipsAtPlayhead();
      return;
    }

    if (cmd === 'timeline.toggleDisableClip') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.toggleDisableTargetClip();
      return;
    }

    if (cmd === 'timeline.toggleMuteClip') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.toggleMuteTargetClip();
      return;
    }

    // --- Timeline Tabs ---
    if (cmd.startsWith('timeline.tab')) {
      const tabIndexStr = cmd.replace('timeline.tab', '');
      const tabIndex = parseInt(tabIndexStr, 10);
      if (!isNaN(tabIndex)) {
        const openPaths = projectStore.projectSettings.timelines.openPaths;
        if (tabIndex > 0 && tabIndex <= openPaths.length) {
          const path = openPaths[tabIndex - 1];
          if (path) {
            void loadTimeline(path);
          }
        }
      }
      return;
    }

    // --- Playback ---
    if (cmd === 'playback.toggle') {
      const canUse = focusStore.canUsePlaybackHotkeys || focusStore.effectiveFocus === 'timeline';
      if (!canUse) return;

      if (focusStore.effectiveFocus === 'left' || focusStore.effectiveFocus === 'right') {
        dispatchPreviewPlayback({ action: 'toggle' });
        return;
      }

      timelineStore.togglePlayback();
      return;
    }

    if (cmd === 'playback.toStart') {
      if (!focusStore.canUsePlaybackHotkeys) return;

      if (focusStore.effectiveFocus === 'left' || focusStore.effectiveFocus === 'right') {
        dispatchPreviewPlayback({ action: 'toStart' });
        return;
      }

      timelineStore.goToStart();
      return;
    }

    if (cmd === 'playback.toEnd') {
      if (!focusStore.canUsePlaybackHotkeys) return;

      if (focusStore.effectiveFocus === 'left' || focusStore.effectiveFocus === 'right') {
        dispatchPreviewPlayback({ action: 'toEnd' });
        return;
      }

      timelineStore.goToEnd();
      return;
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
      'playback.backward1': { direction: 'backward', speed: 1 },
    };

    const speedCmd = playbackSpeedMap[cmd as HotkeyCommandId];
    if (speedCmd) {
      const canUse =
        focusStore.canUsePlaybackHotkeys ||
        (cmd === 'playback.backward1' && focusStore.effectiveFocus === 'timeline');
      if (!canUse) return;

      if (focusStore.effectiveFocus === 'left' || focusStore.effectiveFocus === 'right') {
        dispatchPreviewPlayback({ action: 'set', ...speedCmd });
        return;
      }

      if (cmd === 'playback.backward1' && timelineStore.isPlaying) {
        forceTimelinePlaybackSpeed(speedCmd);
      } else {
        setTimelinePlayback(speedCmd);
      }
      return;
    }

    if (cmd === 'general.mute') {
      timelineStore.toggleAudioMuted();
      return;
    }

    if (cmd === 'general.volumeUp') {
      startVolumeHotkeyHold({ step: 0.05, keyCode: e.code });
      return;
    }

    if (cmd === 'general.volumeDown') {
      startVolumeHotkeyHold({ step: -0.05, keyCode: e.code });
      return;
    }

    if (cmd === 'timeline.toggleVisibilityTrack') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.toggleVisibilityTargetTrack();
      return;
    }

    if (cmd === 'timeline.toggleMuteTrack') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.toggleMuteTargetTrack();
      return;
    }

    if (cmd === 'timeline.toggleSoloTrack') {
      if (!focusStore.canUseTimelineHotkeys) return;
      void timelineStore.toggleSoloTargetTrack();
      return;
    }
  }

  function onGlobalKeyup(e: KeyboardEvent) {
    if (suppressedKeyupCodes.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      suppressedKeyupCodes.delete(e.code);
    }

    volumeHoldRunner.handleKeyup(e.code);
    zoomHoldRunner.handleKeyup(e.code);
  }

  function onGlobalBlur() {
    suppressedKeyupCodes.clear();
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown, true);
    window.addEventListener('keyup', onGlobalKeyup, true);
    window.addEventListener('blur', onGlobalBlur);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeydown, true);
    window.removeEventListener('keyup', onGlobalKeyup, true);
    window.removeEventListener('blur', onGlobalBlur);
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
  });
}
