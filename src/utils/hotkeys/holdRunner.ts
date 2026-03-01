export interface HotkeyHoldTimersState {
  holdTimeout: number | null;
  holdInterval: number | null;
  holdKeyCode: string | null;
}

export function createHotkeyHoldRunner() {
  const state: HotkeyHoldTimersState = {
    holdTimeout: null,
    holdInterval: null,
    holdKeyCode: null,
  };

  function clearTimers() {
    if (state.holdTimeout !== null) {
      window.clearTimeout(state.holdTimeout);
      state.holdTimeout = null;
    }
    if (state.holdInterval !== null) {
      window.clearInterval(state.holdInterval);
      state.holdInterval = null;
    }
    state.holdKeyCode = null;
  }

  function startHold(params: {
    keyCode: string;
    delayMs?: number;
    intervalMs?: number;
    action: () => void;
  }) {
    clearTimers();
    state.holdKeyCode = params.keyCode;

    const delayMs = params.delayMs ?? 350;
    const intervalMs = params.intervalMs ?? 60;

    // Выполняем действие сразу при нажатии
    params.action();

    state.holdTimeout = window.setTimeout(() => {
      state.holdInterval = window.setInterval(() => {
        params.action();
      }, intervalMs);
    }, delayMs);
  }

  function handleKeyup(keyCode: string) {
    if (state.holdKeyCode === keyCode) {
      clearTimers();
    }
  }

  return {
    startHold,
    clearTimers,
    handleKeyup,
    getState: () => ({ ...state }),
  };
}
