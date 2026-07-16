/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFadeDurationsSeconds } from '~/utils/audio/envelope';
import { secondsToTicksSigned } from '~/utils/time';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `audio::mix::tests::effective_fades_matches_shared_parity_fixture` read the
 * SAME fixture, so the web `computeFadeDurationsSeconds` and the native
 * `effective_fades` (src-tauri/src/audio/mix.rs) clamp-then-proportionally-scale
 * overlapping fades identically, keeping the gain envelope hole-free in both.
 */
interface EffectiveFadesCase {
  name: string;
  durationS: number;
  fadeInS: number;
  fadeOutS: number;
  expectedFadeInS: number;
  expectedFadeOutS: number;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/audio-effective-fades.cases.json'), 'utf8'),
) as { epsilon: number; cases: EffectiveFadesCase[] };

describe('audio effective-fades parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const { fadeInS, fadeOutS } = computeFadeDurationsSeconds({
        clipDurationS: c.durationS,
        fadeInTicks: secondsToTicksSigned(c.fadeInS),
        fadeOutTicks: secondsToTicksSigned(c.fadeOutS),
      });
      expect(fadeInS).toBeCloseTo(c.expectedFadeInS, 9);
      expect(fadeOutS).toBeCloseTo(c.expectedFadeOutS, 9);
    });
  }
});
