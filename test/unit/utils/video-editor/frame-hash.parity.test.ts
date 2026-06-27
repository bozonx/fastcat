/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeFrameHash,
  computeColorSignature,
  colorSignatureDistance,
} from '~/utils/video-editor/perceptual-hash';

/**
 * Cross-engine parity contract for the perceptual frame hash. This test and the
 * Rust test `frame_hash_matches_shared_parity_fixture` (in
 * `src-tauri/tests/engine_parity.rs`) read the SAME fixture and rebuild the SAME
 * procedurally-described frames, so the web `computeFrameHash` /
 * `computeColorSignature` and the native mirror can never drift apart.
 *
 * Without this lock the two hash implementations are independent hand-copies and
 * a divergence would silently invalidate every golden-frame parity comparison.
 */
type RGBA = [number, number, number, number];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGBA;
}
interface ParityCase {
  name: string;
  width: number;
  height: number;
  background: RGBA;
  rects: Rect[];
  expectedHash: string;
  expectedColorSig: string;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/frame-hash.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

/** Rebuild an RGBA frame from its procedural description (mirrored in Rust). */
function buildFrame(c: ParityCase): Uint8Array {
  const buf = new Uint8Array(c.width * c.height * 4);
  for (let p = 0; p < c.width * c.height; p++) {
    buf[p * 4] = c.background[0];
    buf[p * 4 + 1] = c.background[1];
    buf[p * 4 + 2] = c.background[2];
    buf[p * 4 + 3] = c.background[3];
  }
  for (const r of c.rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * c.width + x) * 4;
        buf[i] = r.color[0];
        buf[i + 1] = r.color[1];
        buf[i + 2] = r.color[2];
        buf[i + 3] = r.color[3];
      }
    }
  }
  return buf;
}

describe('frame-hash parity (shared fixture)', () => {
  it('has a non-empty fixture', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`reproduces the golden hash + color signature for "${c.name}"`, () => {
      const frame = buildFrame(c);
      expect(computeFrameHash(frame, c.width, c.height)).toBe(c.expectedHash);
      expect(computeColorSignature(frame, c.width, c.height)).toBe(c.expectedColorSig);
      // The signature is always 12 bytes (24 hex chars).
      expect(c.expectedColorSig).toMatch(/^[0-9a-f]{24}$/);
    });
  }

  it('color signature distinguishes hue layouts that share an aHash', () => {
    // These two cases are intentionally constructed to collide on the luminance
    // aHash while differing in hue — the exact blind spot the signature covers.
    const rgbw = fixture.cases.find((c) => c.name === 'quadrants-rgbw');
    const bgrw = fixture.cases.find((c) => c.name === 'quadrants-bgrw');
    expect(rgbw, 'quadrants-rgbw fixture case').toBeDefined();
    expect(bgrw, 'quadrants-bgrw fixture case').toBeDefined();

    expect(rgbw!.expectedHash).toBe(bgrw!.expectedHash);
    expect(rgbw!.expectedColorSig).not.toBe(bgrw!.expectedColorSig);
    expect(
      colorSignatureDistance(rgbw!.expectedColorSig, bgrw!.expectedColorSig),
    ).toBeGreaterThan(0);
  });

  it('color signature distance is symmetric and zero for identical frames', () => {
    const sig = fixture.cases[0]!.expectedColorSig;
    expect(colorSignatureDistance(sig, sig)).toBe(0);
    const a = fixture.cases[0]!.expectedColorSig;
    const b = fixture.cases[1]!.expectedColorSig;
    expect(colorSignatureDistance(a, b)).toBe(colorSignatureDistance(b, a));
  });
});
