import { afterEach, describe, expect, it } from 'vitest';
import { isTauriRuntime } from '~/utils/runtime';

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

function clearTauriGlobal() {
  if (typeof window !== 'undefined') delete (window as TauriGlobal).__TAURI_INTERNALS__;
  delete (globalThis as TauriGlobal).__TAURI_INTERNALS__;
}

describe('isTauriRuntime', () => {
  afterEach(clearTauriGlobal);

  it('returns false when the Tauri global is absent', () => {
    clearTauriGlobal();
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is present on window', () => {
    (window as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });

  it('returns true when __TAURI_INTERNALS__ is present on globalThis', () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });

  it('is the same detector re-exported by io-budget-main and io-governor', async () => {
    const { isTauriRuntime: fromBudget } = await import('~/utils/io/io-budget-main');
    const { isTauriRuntime: fromGovernor } = await import('~/utils/io/io-governor');
    expect(fromBudget).toBe(isTauriRuntime);
    expect(fromGovernor).toBe(isTauriRuntime);
  });
});
