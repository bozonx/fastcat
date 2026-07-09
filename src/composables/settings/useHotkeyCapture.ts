import { ref, onBeforeUnmount } from 'vue';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import {
  hotkeyFromKeyboardEvent,
  isEditableTarget,
  normalizeHotkeyCombo,
} from '~/utils/hotkeys/hotkeyUtils';
import type { HotkeyReservation } from '~/utils/hotkeys/reservedHotkeys';
import { getReservedHotkeyReservation } from '~/utils/hotkeys/reservedHotkeys';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function useHotkeyCapture(params: {
  onCaptured: (cmdId: HotkeyCommandId, combo: string) => void;
  onDuplicate: (cmdId: HotkeyCommandId, combo: string, owner: HotkeyCommandId) => void;
  onReserved?: (cmdId: HotkeyCommandId, combo: string, reservation: HotkeyReservation) => void;
  findDuplicateOwner: (combo: string, targetCmdId: HotkeyCommandId) => HotkeyCommandId | null;
  findOverrideOwner?: (combo: string, targetCmdId: HotkeyCommandId) => HotkeyCommandId | null;
}) {
  const workspaceStore = useWorkspaceStore();
  const isCapturingHotkey = ref(false);
  const captureTargetCommandId = ref<HotkeyCommandId | null>(null);
  const capturedCombo = ref<string | null>(null);

  let captureKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let captureKeyupHandler: ((e: KeyboardEvent) => void) | null = null;
  const pressedKeyIds = new Set<string>();

  function getKeyId(e: KeyboardEvent): string {
    return e.code || e.key;
  }

  function finishCapture() {
    if (captureKeydownHandler) {
      window.removeEventListener('keydown', captureKeydownHandler, true);
      captureKeydownHandler = null;
    }
    if (captureKeyupHandler) {
      window.removeEventListener('keyup', captureKeyupHandler, true);
      captureKeyupHandler = null;
    }
    pressedKeyIds.clear();
    isCapturingHotkey.value = false;
    captureTargetCommandId.value = null;
    capturedCombo.value = null;
  }

  function commitCapturedCombo() {
    const target = captureTargetCommandId.value;
    const combo = capturedCombo.value;
    if (!target || !combo) {
      finishCapture();
      return;
    }

    const reservation = getReservedHotkeyReservation(combo);
    if (reservation) {
      params.onReserved?.(target, combo, reservation);
      finishCapture();
      return;
    }

    const owner = params.findDuplicateOwner(combo, target);
    if (owner) {
      params.onDuplicate(target, combo, owner);
      return;
    }

    const overrideOwner = params.findOverrideOwner?.(combo, target) ?? null;
    if (overrideOwner) {
      params.onCaptured(target, combo);
    } else {
      params.onCaptured(target, combo);
    }
    finishCapture();
  }

  function startCapture(cmdId: HotkeyCommandId) {
    if (isCapturingHotkey.value) return;
    isCapturingHotkey.value = true;
    captureTargetCommandId.value = cmdId;
    capturedCombo.value = null;
    pressedKeyIds.clear();

    const keydownHandler = (e: KeyboardEvent) => {
      if (!isCapturingHotkey.value) {
        window.removeEventListener('keydown', keydownHandler, true);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        finishCapture();
        return;
      }

      if (isEditableTarget(e.target)) {
        return;
      }

      pressedKeyIds.add(getKeyId(e));

      const comboRaw = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);
      const combo = comboRaw ? normalizeHotkeyCombo(comboRaw) : null;
      if (!combo) return;

      e.preventDefault();
      capturedCombo.value = combo;
    };

    const keyupHandler = (e: KeyboardEvent) => {
      if (!isCapturingHotkey.value) {
        window.removeEventListener('keyup', keyupHandler, true);
        return;
      }

      pressedKeyIds.delete(getKeyId(e));
      if (!capturedCombo.value) return;

      e.preventDefault();
      if (pressedKeyIds.size === 0) {
        commitCapturedCombo();
      }
    };

    captureKeydownHandler = keydownHandler;
    captureKeyupHandler = keyupHandler;
    window.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('keyup', keyupHandler, true);
  }

  onBeforeUnmount(() => {
    finishCapture();
  });

  return {
    isCapturingHotkey,
    captureTargetCommandId,
    capturedCombo,
    startCapture,
    finishCapture,
  };
}
