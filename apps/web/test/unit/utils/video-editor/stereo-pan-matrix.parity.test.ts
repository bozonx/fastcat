import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getStereoPanMatrix } from '~/workers/core/audio-dsp';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `audio::mix::tests::stereo_pan_matrix_matches_shared_parity_fixture` read the
 * SAME fixture, so the web `getStereoPanMatrix` and the native `stereo_pan_matrix`
 * (src-tauri/src/audio/mix.rs) can never drift apart on the equal-power
 * pan/balance law that keeps monitor preview and export aligned across engines.
 *
 * Excluded divergence: a non-finite balance. Web sanitizes NaN/Inf to 0
 * (identity); native assumes the scene DTO already sanitized it. That case is
 * web-only below, never in the shared fixture.
 */
interface PanCase {
  name: string;
  balance: number;
  ll: number;
  lr: number;
  rl: number;
  rr: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/stereo-pan-matrix.cases.json'), 'utf8'),
) as { epsilon: number; cases: PanCase[] };

describe('stereo pan-matrix parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const m = getStereoPanMatrix(c.balance);
      expect(m.ll).toBeCloseTo(c.ll, 9);
      expect(m.lr).toBeCloseTo(c.lr, 9);
      expect(m.rl).toBeCloseTo(c.rl, 9);
      expect(m.rr).toBeCloseTo(c.rr, 9);
    });
  }

  it('sanitizes a non-finite balance to centre (web-only divergence)', () => {
    expect(getStereoPanMatrix(Number.NaN)).toEqual({ ll: 1, lr: 0, rl: 0, rr: 1 });
  });
});
