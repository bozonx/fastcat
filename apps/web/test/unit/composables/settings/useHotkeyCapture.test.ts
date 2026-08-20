/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHotkeyCapture } from '~/composables/settings/useHotkeyCapture';
import { hotkeyFromKeyboardEvent, isBareHotkeyCombo } from '~/utils/hotkeys/hotkeyUtils';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: { os: 'linux', hotkeys: {} },
  }),
}));

vi.mock('~/utils/hotkeys/hotkeyUtils', () => ({
  hotkeyFromKeyboardEvent: vi.fn(() => 'Ctrl+A'),
  isBareHotkeyCombo: vi.fn(() => false),
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
    vi.mocked(hotkeyFromKeyboardEvent).mockReturnValue('Ctrl+A');
    vi.mocked(isBareHotkeyCombo).mockReturnValue(false);
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
    expect(window.addEventListener).toHaveBeenCalledWith('keyup', expect.any(Function), true);
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
    expect(window.removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function), true);
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

  it('captures the shortcut as soon as all pressed keys are released', () => {
    const onCaptured = vi.fn();
    const { startCapture, isCapturingHotkey } = useHotkeyCapture({
      onCaptured,
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(() => null),
    });

    startCapture('general.focus' as any);
    const keydownHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keydown')?.[1] as (e: KeyboardEvent) => void;
    const keyupHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keyup')?.[1] as (e: KeyboardEvent) => void;

    keydownHandler({
      key: 'Control',
      code: 'ControlLeft',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent);
    keydownHandler({
      key: 'a',
      code: 'KeyA',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent);

    expect(onCaptured).not.toHaveBeenCalled();

    keyupHandler({
      key: 'a',
      code: 'KeyA',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(onCaptured).not.toHaveBeenCalled();

    keyupHandler({
      key: 'Control',
      code: 'ControlLeft',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(onCaptured).toHaveBeenCalledWith('general.focus', 'Ctrl+A');
    expect(isCapturingHotkey.value).toBe(false);
  });

  it('rejects modifier combos for shuttle stop capture', () => {
    vi.mocked(isBareHotkeyCombo).mockReturnValue(false);
    const onCaptured = vi.fn();
    const { startCapture, isCapturingHotkey, capturedCombo } = useHotkeyCapture({
      onCaptured,
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(() => null),
    });

    startCapture('playback.shuttleStop' as any);
    const keydownHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keydown')?.[1] as (e: KeyboardEvent) => void;
    const keyupHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keyup')?.[1] as (e: KeyboardEvent) => void;
    const keydownEvent = {
      key: 'k',
      code: 'KeyK',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent;

    keydownHandler(keydownEvent);
    keyupHandler({
      key: 'k',
      code: 'KeyK',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(keydownEvent.preventDefault).toHaveBeenCalled();
    expect(capturedCombo.value).toBeNull();
    expect(onCaptured).not.toHaveBeenCalled();
    expect(isCapturingHotkey.value).toBe(true);
  });

  it('captures bare keys for shuttle stop', () => {
    vi.mocked(hotkeyFromKeyboardEvent).mockReturnValue('K');
    vi.mocked(isBareHotkeyCombo).mockReturnValue(true);
    const onCaptured = vi.fn();
    const { startCapture } = useHotkeyCapture({
      onCaptured,
      onDuplicate: vi.fn(),
      findDuplicateOwner: vi.fn(() => null),
    });

    startCapture('playback.shuttleStop' as any);
    const keydownHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keydown')?.[1] as (e: KeyboardEvent) => void;
    const keyupHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keyup')?.[1] as (e: KeyboardEvent) => void;

    keydownHandler({
      key: 'k',
      code: 'KeyK',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent);
    keyupHandler({
      key: 'k',
      code: 'KeyK',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(onCaptured).toHaveBeenCalledWith('playback.shuttleStop', 'K');
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
    const keydownHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keydown')?.[1] as (e: KeyboardEvent) => void;
    const keyupHandler = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'keyup')?.[1] as (e: KeyboardEvent) => void;
    const keydownEvent = {
      key: 'l',
      code: 'KeyL',
      preventDefault: vi.fn(),
      target: null,
    } as unknown as KeyboardEvent;
    const keyupEvent = {
      key: 'l',
      code: 'KeyL',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    keydownHandler(keydownEvent);
    keyupHandler(keyupEvent);

    expect(keydownEvent.preventDefault).toHaveBeenCalled();
    expect(keyupEvent.preventDefault).toHaveBeenCalled();
    expect(onReserved).toHaveBeenCalledWith('general.focus', 'Ctrl+A', { runtime: 'browser' });
    expect(onCaptured).not.toHaveBeenCalled();
    expect(isCapturingHotkey.value).toBe(false);
  });
});
