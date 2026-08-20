/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';

describe('pressedKeyCodes', () => {
  it('is a Set instance', () => {
    expect(pressedKeyCodes).toBeInstanceOf(Set);
  });

  it('tracks key codes via manual add/delete', () => {
    pressedKeyCodes.add('KeyA');
    expect(pressedKeyCodes.has('KeyA')).toBe(true);
    pressedKeyCodes.delete('KeyA');
    expect(pressedKeyCodes.has('KeyA')).toBe(false);
  });

  it('clears all codes on clear', () => {
    pressedKeyCodes.add('KeyA');
    pressedKeyCodes.add('KeyB');
    pressedKeyCodes.clear();
    expect(pressedKeyCodes.size).toBe(0);
  });
});
