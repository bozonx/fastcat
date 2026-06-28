/**
 * One-shot generator for `shared/parity/frame-hash.cases.json`.
 *
 * Builds a set of procedurally-described RGBA frames, computes their expected
 * aHash + color signature with the canonical TS implementation, and writes the
 * fixture. The Rust parity test rebuilds the SAME frames (identical procedural
 * description) and asserts the same expected values, locking the two hash
 * implementations together.
 *
 * Run with: tsx scripts/gen-frame-hash-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFrameHash, computeColorSignature } from '../src/utils/video-editor/perceptual-hash';

type RGBA = [number, number, number, number];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGBA;
}
interface CaseDef {
  name: string;
  width: number;
  height: number;
  background: RGBA;
  rects: Rect[];
}

/** Rebuild an RGBA frame from its procedural description (mirrored in Rust). */
function buildFrame(def: CaseDef): Uint8Array {
  const { width, height, background, rects } = def;
  const buf = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    buf[p * 4] = background[0];
    buf[p * 4 + 1] = background[1];
    buf[p * 4 + 2] = background[2];
    buf[p * 4 + 3] = background[3];
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        buf[i] = r.color[0];
        buf[i + 1] = r.color[1];
        buf[i + 2] = r.color[2];
        buf[i + 3] = r.color[3];
      }
    }
  }
  return buf;
}

const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];
const GRAY: RGBA = [128, 128, 128, 255];

const CASES: CaseDef[] = [
  { name: 'solid-white', width: 8, height: 8, background: WHITE, rects: [] },
  { name: 'solid-black', width: 8, height: 8, background: BLACK, rects: [] },
  { name: 'solid-red', width: 8, height: 8, background: RED, rects: [] },
  {
    name: 'left-white-right-black',
    width: 8,
    height: 8,
    background: BLACK,
    rects: [{ x: 0, y: 0, w: 4, h: 8, color: WHITE }],
  },
  {
    name: 'top-white-bottom-black',
    width: 8,
    height: 8,
    background: BLACK,
    rects: [{ x: 0, y: 0, w: 8, h: 4, color: WHITE }],
  },
  {
    name: 'quadrants-rgbw',
    width: 8,
    height: 8,
    background: BLACK,
    rects: [
      { x: 0, y: 0, w: 4, h: 4, color: RED },
      { x: 4, y: 0, w: 4, h: 4, color: GREEN },
      { x: 0, y: 4, w: 4, h: 4, color: BLUE },
      { x: 4, y: 4, w: 4, h: 4, color: WHITE },
    ],
  },
  {
    // Same geometry as quadrants-rgbw with red/blue swapped: a different hue
    // layout that the luminance aHash alone cannot distinguish from some other
    // arrangements — the color signature must.
    name: 'quadrants-bgrw',
    width: 8,
    height: 8,
    background: BLACK,
    rects: [
      { x: 0, y: 0, w: 4, h: 4, color: BLUE },
      { x: 4, y: 0, w: 4, h: 4, color: GREEN },
      { x: 0, y: 4, w: 4, h: 4, color: RED },
      { x: 4, y: 4, w: 4, h: 4, color: WHITE },
    ],
  },
  {
    name: 'gray-center-square',
    width: 16,
    height: 16,
    background: GRAY,
    rects: [{ x: 4, y: 4, w: 8, h: 8, color: WHITE }],
  },
];

const cases = CASES.map((def) => {
  const buf = buildFrame(def);
  return {
    ...def,
    expectedHash: computeFrameHash(buf, def.width, def.height),
    expectedColorSig: computeColorSignature(buf, def.width, def.height),
  };
});

const out = {
  _comment: [
    'Cross-engine parity fixture for the perceptual frame hash.',
    'Each case describes an RGBA frame procedurally (background fill + ordered',
    'rectangles). The web/TS hash (src/utils/video-editor/perceptual-hash.ts) and',
    'the native/Rust hash (src-tauri/tests/engine_parity.rs) both rebuild the',
    'frame and must reproduce expectedHash (64-bit luma aHash) and',
    'expectedColorSig (2x2 mean-color, 12 bytes). This locks the two independent',
    'implementations together so they can never silently drift.',
    'Regenerate with: tsx scripts/gen-frame-hash-fixture.ts',
  ],
  cases,
};

const path = resolve(process.cwd(), 'shared/parity/frame-hash.cases.json');
writeFileSync(path, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`Wrote ${cases.length} cases to ${path}`);
for (const c of cases) {
  console.log(`  ${c.name}: hash=${c.expectedHash} colorSig=${c.expectedColorSig}`);
}
