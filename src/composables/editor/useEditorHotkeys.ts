import { onMounted, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { getActiveElement } from '~/utils/browser-api';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import { getDocFpsOrDefault } from '~/timeline/commands/utils';
import { resolvePreviewTransport, type PreviewRoute } from '~/utils/hotkeys/previewTransport';
import {
  canExecuteHotkeyCommand,
  getHotkeyCommandGroup,
  getFocusAwareHotkeyOrder,
  getMatchedHotkeyCommands,
  isPreviewLikeFocus,
  shouldBlurAfterHotkey,
  shouldHandleRepeatForMatchedCommands,
} from '~/utils/hotkeys/runtime';

import { useGeneralHotkeys } from './hotkeys/useGeneralHotkeys';
import { useTimelineHotkeys } from './hotkeys/useTimelineHotkeys';
import { usePlaybackHotkeys } from './hotkeys/usePlaybackHotkeys';

export function hasBlockingModalState(): boolean {
  return !!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]');
}

const ARROW_KEY_DIRECTIONS: Record<string, 'up' | 'down' | 'left' | 'right' | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function useEditorHotkeys() {
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();

  const volumeHoldRunner = createHotkeyHoldRunner();
  const zoomHoldRunner = createHotkeyHoldRunner();
  const navigationHoldRunner = createHotkeyHoldRunner();
  const playbackStepHoldRunner = createHotkeyHoldRunner();

  const suppressedKeyupCodes = new Set<string>();

  const generalHandlers = useGeneralHotkeys(zoomHoldRunner, volumeHoldRunner);
  const timelineHandlers = useTimelineHotkeys(navigationHoldRunner);
  const { effectiveHotkeys, hotkeyLookup } = useEffectiveHotkeys();
  const playbackHandlers = usePlaybackHotkeys(playbackStepHoldRunner, effectiveHotkeys);

  // Combine handlers that overlap (copy, cut, paste)
  const registry: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    ...generalHandlers,
    ...timelineHandlers,
    ...playbackHandlers,
  };

  // Explicitly resolve overlapping handlers
  const overlappingKeys: HotkeyCommandId[] = ['general.copy', 'general.cut', 'general.paste'];
  for (const key of overlappingKeys) {
    if (generalHandlers[key] && timelineHandlers[key]) {
      registry[key] = (e: KeyboardEvent) => {
        // Timeline has priority if focus allows timeline hotkeys
        if (focusStore.canUseTimelineHotkeys && timelineHandlers[key]!(e)) return true;
        return generalHandlers[key]!(e);
      };
    }
  }

  function isFullscreen() {
    return projectStore.currentView === 'fullscreen';
  }

  function canHandleFocusTab() {
    if (hasBlockingModalState()) return false;
    if (!projectStore.currentProjectName) return false;
    return (
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'sound'
    );
  }

  function handleFocusCommand() {
    if (projectStore.currentView === 'files') {
      focusStore.handleFilesViewFocusHotkey();
      return;
    }

    focusStore.handleFocusHotkey();
  }

  function applyPreviewRoute(route: PreviewRoute) {
    if (route.kind === 'action') {
      uiStore.triggerPreviewPlayback(route.action);
      return;
    }

    if (route.kind === 'step') {
      const fps = getDocFpsOrDefault(timelineStore.timelineDoc);
      uiStore.triggerPreviewPlayback('step', undefined, undefined, route.frames / fps);
      return;
    }

    if (route.kind === 'setSpeed') {
      uiStore.triggerPreviewPlayback('set', route.speed, 'forward');
      return;
    }

    if (route.kind === 'volume') {
      uiStore.triggerPreviewPlayback(route.delta >= 0 ? 'volumeUp' : 'volumeDown');
      return;
    }

    uiStore.triggerPreviewPlayback('toggleMute');
  }

  function dispatchMatchedCommands(matched: HotkeyCommandId[], e: Event): boolean {
    const modalOpen = hasBlockingModalState();
    const fullscreen = isFullscreen();

    if (matched.includes('general.focus') && canHandleFocusTab()) {
      if (isEditableTarget((e as KeyboardEvent).target)) return false;

      e.preventDefault();
      handleFocusCommand();
      return true;
    }

    const keyboardEvent = e as KeyboardEvent;
    const isArrowKey = keyboardEvent.key.startsWith('Arrow');
    const isFileManagerHotkeyFocus =
      focusStore.canUseFileManagerHotkeys || focusStore.effectiveFocus === 'filesBrowser';

    // Arrow keys inside the file manager drive local list selection. They are
    // intentionally excluded from the global customizable commands, so bridge
    // them to the focused browser here. This works even when DOM focus is not
    // on a list item (e.g. after selecting via click) — the previous code only
    // filtered these out, so list navigation silently died in that state.
    if (isFileManagerHotkeyFocus && isArrowKey && !modalOpen) {
      const fileManagerMatched = matched.filter(
        (cmdId) => getHotkeyCommandGroup(cmdId) === 'fileManager',
      );
      if (fileManagerMatched.length === 0) {
        const hasArrowModifier =
          keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey;
        const dir = hasArrowModifier ? undefined : ARROW_KEY_DIRECTIONS[keyboardEvent.key];
        if (dir) {
          uiStore.triggerFileBrowserMoveSelection(dir);
          e.preventDefault();
          return true;
        }
        return false;
      }
      matched = fileManagerMatched;
    }

    if (matched.length === 0) return false;

    const previewActive =
      uiStore.previewModalOpen ||
      (uiStore.hasActivePreviewPlayer && isPreviewLikeFocus(focusStore.effectiveFocus));

    if (previewActive && !modalOpen) {
      for (const cmdId of matched) {
        const route = resolvePreviewTransport(cmdId);
        if (!route) continue;

        if (route !== 'block') {
          applyPreviewRoute(route);
        }

        e.preventDefault();
        e.stopPropagation();
        (e as Event).stopImmediatePropagation?.();
        return true;
      }
    }

    const isEditableEventTarget = isEditableTarget((e as KeyboardEvent).target);
    const isEditableActiveElement = isEditableTarget(getActiveElement());

    const focusAwareOrder = getFocusAwareHotkeyOrder({
      matched,
      canUseFileManagerHotkeys: focusStore.canUseFileManagerHotkeys,
      canUseTimelineHotkeys: focusStore.canUseTimelineHotkeys,
      canUseMonitorHotkeys: focusStore.canUseMonitorHotkeys,
    });

    for (const cmdId of focusAwareOrder) {
      if (
        !canExecuteHotkeyCommand({
          cmdId,
          hasBlockingModalState: modalOpen,
          isFullscreen: fullscreen,
          isEditableEventTarget,
          isEditableActiveElement,
        })
      ) {
        continue;
      }

      const handler = registry[cmdId];
      if (handler) {
        const executed = handler(e as KeyboardEvent);
        if (executed) {
          if (
            shouldBlurAfterHotkey({
              cmdId,
              activeElement: getActiveElement(),
            })
          ) {
            (getActiveElement() as HTMLElement | null)?.blur();
          }
          e.preventDefault();
          e.stopPropagation();
          (e as Event).stopImmediatePropagation?.();
          return true;
        }
      }
    }
    return false;
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;

    const literalCombo = hotkeyFromKeyboardEvent(e);
    const layeredCombo = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);

    if (!literalCombo && !layeredCombo) return;

    let matched = getMatchedHotkeyCommands({ combo: literalCombo, lookup: hotkeyLookup.value });

    if (matched.length === 0 && layeredCombo && layeredCombo !== literalCombo) {
      // Match the virtual-layer combo against the user's effective bindings so
      // customised/removed hotkeys are honoured (previously matched against the
      // built-in defaults, which resurrected removed bindings and ignored
      // custom ones for users with non-default modifier layers).
      matched = getMatchedHotkeyCommands({
        combo: layeredCombo,
        lookup: hotkeyLookup.value,
      });
    }

    if (matched.length === 0) return;

    if (e.repeat && !shouldHandleRepeatForMatchedCommands(matched)) return;

    if (matched.includes('general.deselect')) {
      if (timelineStore.isTrimModeActive) {
        timelineStore.isTrimModeActive = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    if (dispatchMatchedCommands(matched, e)) {
      suppressedKeyupCodes.add(e.code);
    }
  }

  function onGlobalKeyup(e: KeyboardEvent) {
    if (suppressedKeyupCodes.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      (e as Event).stopImmediatePropagation?.();
      suppressedKeyupCodes.delete(e.code);
    }

    volumeHoldRunner.handleKeyup(e.code);
    zoomHoldRunner.handleKeyup(e.code);
    navigationHoldRunner.handleKeyup(e.code);
    playbackStepHoldRunner.handleKeyup(e.code);
  }

  function onGlobalPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes((target.type || '').toLowerCase()))
    ) {
      target.blur();
    }
  }

  function onGlobalBlur() {
    suppressedKeyupCodes.clear();
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
    navigationHoldRunner.clearTimers();
    playbackStepHoldRunner.clearTimers();
  }

  // To prevent stuck keys if window loses focus while a key is pressed,
  // we also listen to 'visibilitychange' which sometimes catches what 'blur' misses
  function onVisibilityChange() {
    if (document.hidden) {
      suppressedKeyupCodes.clear();
      volumeHoldRunner.clearTimers();
      zoomHoldRunner.clearTimers();
      navigationHoldRunner.clearTimers();
      playbackStepHoldRunner.clearTimers();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('keyup', onGlobalKeyup);
    window.addEventListener('blur', onGlobalBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onGlobalPointerDown, true);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
    window.removeEventListener('keyup', onGlobalKeyup);
    window.removeEventListener('blur', onGlobalBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pointerdown', onGlobalPointerDown, true);
    volumeHoldRunner.clearTimers();
    zoomHoldRunner.clearTimers();
    navigationHoldRunner.clearTimers();
    playbackStepHoldRunner.clearTimers();
  });
}
