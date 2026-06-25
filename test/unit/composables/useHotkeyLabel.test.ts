/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

vi.mock('~/utils/hotkeys/effectiveHotkeys', () => ({
  getEffectiveHotkeyBindings: vi.fn(() => ({
    'play-pause': ['Space'],
    undo: ['Ctrl+Z'],
    redo: ['Ctrl+Shift+Z'],
  })),
}));

describe('useHotkeyLabel', () => {
  it('returns label for known command', () => {
    const { getHotkeyLabel } = useHotkeyLabel();
    expect(getHotkeyLabel('play-pause')).toBe('Space');
  });

  it('returns null for unknown command', () => {
    const { getHotkeyLabel } = useHotkeyLabel();
    expect(getHotkeyLabel('nonexistent' as never)).toBeNull();
  });

  it('returns multiple bindings joined by comma', () => {
    const { getHotkeyLabel } = useHotkeyLabel();
    // redo has Ctrl+Shift+Z
    expect(getHotkeyLabel('redo')).toBe('Ctrl+Shift+Z');
  });

  it('getHotkeyKbds returns split keys for first binding', () => {
    const { getHotkeyKbds } = useHotkeyLabel();
    const kbds = getHotkeyKbds('undo');
    expect(kbds).toEqual(['Ctrl', 'Z']);
  });

  it('getHotkeyKbds returns undefined for unknown command', () => {
    const { getHotkeyKbds } = useHotkeyLabel();
    expect(getHotkeyKbds('nonexistent' as never)).toBeUndefined();
  });

  it('getHotkeyTitle appends label in parentheses', () => {
    const { getHotkeyTitle } = useHotkeyLabel();
    expect(getHotkeyTitle('Play', 'play-pause')).toBe('Play (Space)');
  });

  it('getHotkeyTitle returns base title when no label found', () => {
    const { getHotkeyTitle } = useHotkeyLabel();
    expect(getHotkeyTitle('Play', 'nonexistent' as never)).toBe('Play');
  });
});
