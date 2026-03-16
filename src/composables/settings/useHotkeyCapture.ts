import { ref, onBeforeUnmount } from 'vue';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { hotkeyFromKeyboardEvent, isEditableTarget, normalizeHotkeyCombo } from '~/utils/hotkeys/hotkeyUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';

export function useHotkeyCapture(params: {
  onCaptured: (cmdId: HotkeyCommandId, combo: string) => void;
  onDuplicate: (cmdId: HotkeyCommandId, combo: string, owner: HotkeyCommandId) => void;
  findDuplicateOwner: (combo: string, targetCmdId: HotkeyCommandId) => HotkeyCommandId | null;
}) {
  const workspaceStore = useWorkspaceStore();
  const isCapturingHotkey = ref(false);
  const captureTargetCommandId = ref<HotkeyCommandId | null>(null);
  const capturedCombo = ref<string | null>(null);
  
  let captureKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  function finishCapture() {
    if (captureKeydownHandler) {
      window.removeEventListener('keydown', captureKeydownHandler, true);
      captureKeydownHandler = null;
    }
    isCapturingHotkey.value = false;
    captureTargetCommandId.value = null;
    capturedCombo.value = null;
  }

  function startCapture(cmdId: HotkeyCommandId) {
    if (isCapturingHotkey.value) return;
    isCapturingHotkey.value = true;
    captureTargetCommandId.value = cmdId;
    capturedCombo.value = null;

    const handler = (e: KeyboardEvent) => {
      if (!isCapturingHotkey.value) {
        window.removeEventListener('keydown', handler, true);
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

      const comboRaw = hotkeyFromKeyboardEvent(e, workspaceStore.userSettings);
      const combo = comboRaw ? normalizeHotkeyCombo(comboRaw) : null;
      if (!combo) return;

      e.preventDefault();
      capturedCombo.value = combo;

      const target = captureTargetCommandId.value;
      if (!target) {
        finishCapture();
        return;
      }

      const owner = params.findDuplicateOwner(combo, target);
      if (owner) {
        params.onDuplicate(target, combo, owner);
      } else {
        params.onCaptured(target, combo);
        finishCapture();
      }
    };

    captureKeydownHandler = handler;
    window.addEventListener('keydown', handler, true);
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
