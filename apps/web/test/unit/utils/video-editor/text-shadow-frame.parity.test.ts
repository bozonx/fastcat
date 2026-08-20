import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeTextLayoutMetrics } from '~/utils/video-editor/text-layout';
import type { TextClipStyle } from '~/timeline/types';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `monitor::scene::build::tests::text_shadow_frame_matches_shared_parity_fixture`
 * read the SAME fixture, so the web `computeTextLayoutMetrics` and the native
 * `build_text_layer` shadow/border bounding-box math can never drift apart.
 */
interface ParityCase {
  name: string;
  text: string;
  style: Record<string, unknown>;
  expected: {
    frameWidth: number;
    frameHeight: number;
    shadowLeft: number;
    shadowTop: number;
    shadowRight: number;
    shadowBottom: number;
    backgroundWidth: number;
    backgroundHeight: number;
    frameX: number;
    frameY: number;
  };
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/text-shadow-frame.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

describe('text shadow/border frame parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const metrics = computeTextLayoutMetrics({
        text: c.text,
        style: c.style as TextClipStyle,
        canvasWidth: 1920,
        canvasHeight: 1080,
        // Frame size is dominated by the explicit width/height in every fixture
        // case, so the measured glyph width never influences frameWidth/Height —
        // any deterministic measurer works here.
        measureText: (text) => text.length * 10,
      });

      expect(metrics.frameWidth).toBeCloseTo(c.expected.frameWidth, 6);
      expect(metrics.frameHeight).toBeCloseTo(c.expected.frameHeight, 6);
      expect(metrics.frameX).toBeCloseTo(c.expected.frameX, 6);
      expect(metrics.frameY).toBeCloseTo(c.expected.frameY, 6);
      expect(metrics.backgroundWidth).toBeCloseTo(c.expected.backgroundWidth, 6);
      expect(metrics.backgroundHeight).toBeCloseTo(c.expected.backgroundHeight, 6);
    });
  }
});
