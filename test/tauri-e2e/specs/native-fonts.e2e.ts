import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';

describe('Native Fonts (P1)', () => {
  it('returns a non-empty array of unique, non-empty font family strings', async () => {
    const fonts = await invokeTauri<string[]>('native_system_fonts');

    expect(Array.isArray(fonts)).toBe(true);
    expect(fonts.length).toBeGreaterThan(0);

    const fontSet = new Set<string>();
    for (const font of fonts) {
      expect(typeof font).toBe('string');
      expect(font.trim().length).toBeGreaterThan(0);
      fontSet.add(font);
    }

    // Assert no duplicates in the returned list
    expect(fontSet.size).toBe(fonts.length);
  });
});
