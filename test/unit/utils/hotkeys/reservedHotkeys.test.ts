import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getReservedHotkeyReservation } from '~/utils/hotkeys/reservedHotkeys';
import { isTauriRuntime } from '~/utils/runtime';

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

describe('reservedHotkeys', () => {
  beforeEach(() => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
  });

  it('marks browser navigation and tab shortcuts as reserved in web runtime', () => {
    expect(getReservedHotkeyReservation('Ctrl+L')).toEqual({ runtime: 'browser' });
    expect(getReservedHotkeyReservation('Meta+Shift+T')).toEqual({ runtime: 'browser' });
    expect(getReservedHotkeyReservation('F5')).toEqual({ runtime: 'browser' });
  });

  it('does not reserve regular application shortcuts in web runtime', () => {
    expect(getReservedHotkeyReservation('Ctrl+S')).toBeNull();
    expect(getReservedHotkeyReservation('Shift+R')).toBeNull();
  });

  it('uses tauri reservations in desktop runtime', () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    expect(getReservedHotkeyReservation('Alt+F4')).toEqual({ runtime: 'tauri' });
    expect(getReservedHotkeyReservation('Meta+Space')).toEqual({ runtime: 'tauri' });
    expect(getReservedHotkeyReservation('Ctrl+L')).toBeNull();
  });
});
