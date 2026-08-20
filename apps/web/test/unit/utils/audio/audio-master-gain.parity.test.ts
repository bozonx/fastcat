import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeMasterGain } from '~/utils/audio/clamp';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `audio::mix::tests::sanitize_master_gain_matches_shared_parity_fixture` read
 * the SAME fixture, so the web `sanitizeMasterGain` (src/utils/audio/clamp.ts)
 * and the native `sanitize_master_gain` (src-tauri/src/audio/mix.rs) can never
 * drift apart on the gain baked into the rendered/exported mix.
 *
 * Non-finite inputs are encoded as the strings 'nan'/'inf'/'-inf' because JSON
 * has no NaN/Infinity literal; both engines map them back before testing.
 */
interface MasterGainCase {
  name: string;
  gain: number | string;
  out: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/audio-master-gain.cases.json'), 'utf8'),
) as { maxMasterGain: number; cases: MasterGainCase[] };

function decodeGain(gain: number | string): number {
  if (typeof gain === 'number') return gain;
  switch (gain) {
    case 'nan':
      return Number.NaN;
    case 'inf':
      return Number.POSITIVE_INFINITY;
    case '-inf':
      return Number.NEGATIVE_INFINITY;
    default:
      throw new Error(`unexpected non-numeric gain sentinel: ${gain}`);
  }
}

describe('master-gain parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      expect(sanitizeMasterGain(decodeGain(c.gain))).toBeCloseTo(c.out, 9);
    });
  }
});
