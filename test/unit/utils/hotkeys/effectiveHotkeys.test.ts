/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';

vi.mock('~/utils/hotkeys/defaultHotkeys', () => ({
  DEFAULT_HOTKEYS: {
    commands: [
      { id: 'play', groupId: 'general', label: 'Play' },
      { id: 'pause', groupId: 'general', label: 'Pause' },
    ],
    bindings: {
      play: ['Space'],
      pause: ['Enter'],
    },
  },
}));

describe('getEffectiveHotkeyBindings', () => {
  it('returns default bindings when no overrides', () => {
    const result = getEffectiveHotkeyBindings({ bindings: {} });
    expect(result.play).toEqual(['Space']);
    expect(result.pause).toEqual(['Enter']);
  });

  it('applies user overrides', () => {
    const result = getEffectiveHotkeyBindings({ bindings: { play: ['Shift+Space'] } });
    expect(result.play).toEqual(['Shift+Space']);
    expect(result.pause).toEqual(['Enter']);
  });

  it('normalizes and deduplicates combos', () => {
    const result = getEffectiveHotkeyBindings({ bindings: { play: ['shift+space', 'Shift+Space'] } });
    expect(result.play).toEqual(['Shift+Space']);
  });
});
