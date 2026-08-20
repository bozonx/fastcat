import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getGainAtClipTime, type AudioFadeCurve } from '~/utils/audio/envelope';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `audio::mix::tests::fade_curve_matches_shared_parity_fixture` read the SAME
 * fixture, so the web fade-curve multiplier (`applyFadeCurve`, exercised here
 * through the exported `getGainAtClipTime`) and the native `fade_curve`
 * (src-tauri/src/audio/mix.rs) can never drift apart.
 *
 * The curve is isolated by driving a unit-gain clip whose fade-in spans the
 * whole clip: gain(t) == applyFadeCurve(t / fadeIn). progress is mapped onto the
 * fade window, so out-of-range progress exercises the [0,1] clamp both engines
 * apply to the curve input.
 */
interface FadeCurveCase {
  name: string;
  curve: AudioFadeCurve;
  progress: number;
  gain: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/audio-fade-curve.cases.json'), 'utf8'),
) as { epsilon: number; cases: FadeCurveCase[] };

const CLIP_DURATION_S = 10;

describe('audio fade-curve parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const gain = getGainAtClipTime({
        clipDurationS: CLIP_DURATION_S,
        fadeInS: CLIP_DURATION_S,
        fadeOutS: 0,
        fadeInCurve: c.curve,
        baseGain: 1,
        tClipS: c.progress * CLIP_DURATION_S,
      });
      expect(gain).toBeCloseTo(c.gain, 9);
    });
  }
});
