/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHotkeyCapture } from '~/composables/settings/useHotkeyCapture';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: { os: 'linux', hotkeys: {} },
  }),
}));

vi.mock('~/utils/hotkeys/hotkeyUtils', () => ({
  hotkeyFromKeyboardEvent: vi.fn(() => 'Ctrl+A'),
  isEditableTarget: vi.fn(() => false),
  normalizeHotkeyCombo: vi.fn((c: string) => c),
}));

vi.mock('~/utils/hotkeys/reservedHotkeys', () => ({
  getReservedHotkeyReservation: vi.fn(() => null),
}));

describe('useHotkeyCapture', () => {
  let originalAddEventListener: typeof window.addEventListener;
  let originalRemoveEventListener: typeof window.removeEventListener;

  beforeEach(() => {
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;
    window.addEventListener = vi.fn();
    window.removeEventListener = vi.fn();
  });

  afterEach(() => {
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
  });

  it('initializes with default state', () => {
    const { isCapturingHotkey, captureTargetCommandId, capturedCombo } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    expect(isCapturingHotkey.value).toBe(false);
    expect(captureTargetCommandId.value).toBeNull();
    expect(capturedCombo.value).toBeNull();
  });

  it('startCapture sets capturing state', () => {
    const { isCapturingHotkey, captureTargetCommandId, startCapture } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    startCapture('play_pause' as any);
    expect(isCapturingHotkey.value).toBe(true);
    expect(captureTargetCommandId.value).toBe('play_pause');
    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('startCapture does nothing when already capturing', () => {
    const { isCapturingHotkey, startCapture } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    startCapture('cmd1' as any);
    expect(isCapturingHotkey.value).toBe(true);
    startCapture('cmd2' as any);
    // Should still be targeting cmd1
    expect(isCapturingHotkey.value).toBe(true);
  });

  it('finishCapture resets state and removes listener', () => {
    const {
      isCapturingHotkey,
      captureTargetCommandId,
      capturedCombo,
      startCapture,
      finishCapture,
    } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    startCapture('cmd1' as any);
    finishCapture();
    expect(isCapturingHotkey.value).toBe(false);
    expect(captureTargetCommandId.value).toBeNull();
    expect(capturedCombo.value).toBeNull();
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('finishCapture does nothing when not capturing', () => {
    const { finishCapture } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    expect(() => finishCapture()).not.toThrow();
  });

  it('returns startCapture and finishCapture functions', () => {
    const { startCapture, finishCapture } = useHotkeyCapture({
      onCaptured: vi.fn(),
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(),
    });
    expect(typeof startCapture).toBe('function');
    expect(typeof finishCapture).toBe('function');
  });

  it('reports reserved shortcuts and stops capture', async () => {
    const { getReservedHotkeyReservation } = await import('~/utils/hotkeys/reservedHotkeys');
    vi.mocked(getReservedHotkeyReservation).mockReturnValue({ runtime: 'browser' });

    const onReserved = vi.fn();
    const onCaptured = vi.fn();
    const { startCapture, isCapturingHotkey } = useHotkeyCapture({
      onCaptured,
      onDuplicate: vi.fn(),
      onReserved,
      findDuplicateOwner: vi.fn(),
    });

    startCapture('general.focus' as any);
    const handler = vi.mocked(window.addEventListener).mock.calls[0]?.[1] as (
      e: KeyboardEvent,
    ) => void;
    const event = {
      key: 'l',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent;

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(onReserved).toHaveBeenCalledWith('general.focus', 'Ctrl+A', { runtime: 'browser' });
    expect(onCaptured).not.toHaveBeenCalled();
    expect(isCapturingHotkey.value).toBe(false);
  });
});
