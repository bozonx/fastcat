import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hexToRgb01 } from '~/utils/color';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `compositor::transitions::tests::parse_hex_color_matches_shared_parity_fixture`.
 */
interface ColorCase {
  name: string;
  hex: string;
  expected: [number, number, number];
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/hex-color-rgb01.cases.json'), 'utf8'),
) as { cases: ColorCase[] };

describe('hex-color rgb01 parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const [r, g, b] = hexToRgb01(c.hex);
      expect(r).toBeCloseTo(c.expected[0], 9);
      expect(g).toBeCloseTo(c.expected[1], 9);
      expect(b).toBeCloseTo(c.expected[2], 9);
    });
  }

  // KNOWN INTENTIONAL DIVERGENCE FROM THE NATIVE ENGINE (excluded from the fixture):
  // the web engine expands 3-digit shorthand; the native engine treats it as invalid.
  it('web expands 3-digit shorthand', () => {
    expect(hexToRgb01('#f00')).toEqual([1, 0, 0]);
  });
});
