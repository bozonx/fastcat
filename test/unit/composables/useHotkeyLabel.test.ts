/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const mockWorkspaceStore = vi.hoisted(() => ({
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {},
    },
  },
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/utils/hotkeys/effectiveHotkeys', () => ({
  getEffectiveHotkeyBindings: vi.fn(() => ({
    'play-pause': ['Space'],
    undo: ['Modifier2+Z'],
    redo: ['Modifier2+Modifier1+Z'],
    splitAll: ['Modifier1+T'],
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
    expect(getHotkeyLabel('redo')).toBe('Ctrl+Shift+Z');
  });

  it('getHotkeyKbds returns split keys for first binding', () => {
    const { getHotkeyKbds } = useHotkeyLabel();
    const kbds = getHotkeyKbds('undo');
    expect(kbds).toEqual(['Ctrl', 'Z']);
  });

  it('renders virtual modifiers using user layer settings', () => {
    mockWorkspaceStore.userSettings.hotkeys.layer1 = 'Alt';
    mockWorkspaceStore.userSettings.hotkeys.layer2 = 'ControlRight';

    const { getHotkeyLabel, getHotkeyKbds } = useHotkeyLabel();

    expect(getHotkeyLabel('redo')).toBe('Right Ctrl+Alt+Z');
    expect(getHotkeyLabel('splitAll')).toBe('Alt+T');
    expect(getHotkeyKbds('redo')).toEqual(['Right Ctrl', 'Alt', 'Z']);

    mockWorkspaceStore.userSettings.hotkeys.layer1 = 'Shift';
    mockWorkspaceStore.userSettings.hotkeys.layer2 = 'Control';
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
