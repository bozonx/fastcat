import { onMounted, onUnmounted } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFocusStore } from '~/stores/focus.store';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';

import { useGeneralHotkeys } from './hotkeys/useGeneralHotkeys';
import { useTimelineHotkeys } from './hotkeys/useTimelineHotkeys';
import { usePlaybackHotkeys } from './hotkeys/usePlaybackHotkeys';

export function useEditorHotkeys() {
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();

  const volumeHoldRunner = createHotkeyHoldRunner();
  const zoomHoldRunner = createHotkeyHoldRunner();

  const suppressedKeyupCodes = new Set<string>();

  const generalHandlers = useGeneralHotkeys(zoomHoldRunner, volumeHoldRunner);
  const timelineHandlers = useTimelineHotkeys();
  const playbackHandlers = usePlaybackHotkeys();

  const registry: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    ...generalHandlers,
    ...timelineHandlers,
    ...playbackHandlers,
  };

  async function onGlobalKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.repeat) return;

    if (document.querySelector('[role="dialog"]') && e.key !== 'Escape') return;

    if (e.key === 'Tab' && focusStore.tempFocus !== 'none') {
      e.preventDefault();
      focusStore.handleFocusHotkey();
      return;
    }

    if (isEditableTarget(e.target) && e.key !== 'Escape') return;
    if (isEditableTarget(document.activeElement) && e.key !== 'Escape') return;

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

    const cmd: HotkeyCommandId = focusAware as HotkeyCommandId;
    const handler = registry[cmd];

    if (handler) {
      const executed = handler(e);
      if (executed) {
        if (document.activeElement instanceof HTMLElement) {
          if (!isEditableTarget(document.activeElement)) {
            document.activeElement.blur();
          }
        }
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        suppressedKeyupCodes.add(e.code);
      }
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
