/**
 * Canonical perceptual hashing for cross-engine frame parity.
 *
 * This is the SINGLE source of truth for the hash used by every parity layer:
 *   - the web engine render page (`pages/test/parity.vue`),
 *   - the parity test helpers (`test/parity-helpers/frame-hash.ts`),
 *   - the golden generator scripts.
 *
 * The native (Rust) engine mirrors this implementation in
 * `src-tauri/tests/engine_parity.rs`. The two implementations are locked
 * together by the shared fixture `shared/parity/frame-hash.cases.json`, which
 * both a TS test and a Rust test render and assert against, so they can never
 * silently drift apart.
 *
 * Two complementary signatures are computed per frame:
 *
 *   1. `computeFrameHash` — a 64-bit luminance average hash (aHash). Tolerant
 *      to sub-pixel rasterization differences, sensitive to structural changes.
 *      Compared via Hamming distance.
 *
 *   2. `computeColorSignature` — a 2x2 mean-color grid (12 bytes). aHash is
 *      luminance-only and is blind to hue/chroma errors (e.g. a red layer
 *      rendered green has the same luma). The color signature catches those.
 *      Compared via L1 (Manhattan) distance.
 */

/** Grayscale coefficients (Rec. 601 luma). */
const R_COEF = 0.299;
const G_COEF = 0.587;
const B_COEF = 0.114;

/** Downsample a RGBA buffer to an 8x8 grayscale grid using box averaging. */
function downsampleTo8x8(
  rgba: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
): Float64Array {
  const grid = new Float64Array(64);
  const counts = new Float64Array(64);

  const xStep = srcWidth / 8;
  const yStep = srcHeight / 8;

  for (let y = 0; y < srcHeight; y++) {
    const gy = Math.min(7, Math.floor(y / yStep));
    for (let x = 0; x < srcWidth; x++) {
      const gx = Math.min(7, Math.floor(x / xStep));
      const i = (y * srcWidth + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const luma = R_COEF * r + G_COEF * g + B_COEF * b;
      const idx = gy * 8 + gx;
      grid[idx]! += luma;
      counts[idx]! += 1;
    }
  }

  for (let i = 0; i < 64; i++) {
    grid[i] = counts[i]! > 0 ? grid[i]! / counts[i]! : 0;
  }

  return grid;
}

/** Compute the 64-bit luminance average hash as a hex string (16 chars). */
export function computeFrameHash(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const grid = downsampleTo8x8(rgba, width, height);

  let sum = 0;
  for (let i = 0; i < 64; i++) {
    sum += grid[i]!;
  }
  const mean = sum / 64;

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (grid[i]! > mean) {
      hash |= 1n << BigInt(63 - i);
    }
  }

  return hash.toString(16).padStart(16, '0');
}

/** Number of quadrant cells per axis for the color signature. */
const COLOR_CELLS = 2;

/**
 * Compute a 2x2 mean-color signature as a 24-char hex string.
 *
 * Each of the 4 quadrants contributes its mean R, G, B (one byte each), laid
 * out as `q0R q0G q0B q1R q1G q1B q2R q2G q2B q3R q3G q3B`, where quadrant
 * index = gy * 2 + gx (top-left, top-right, bottom-left, bottom-right).
 */
export function computeColorSignature(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const cells = COLOR_CELLS * COLOR_CELLS;
  const sumR = new Float64Array(cells);
  const sumG = new Float64Array(cells);
  const sumB = new Float64Array(cells);
  const counts = new Float64Array(cells);

  const xStep = width / COLOR_CELLS;
  const yStep = height / COLOR_CELLS;

  for (let y = 0; y < height; y++) {
    const gy = Math.min(COLOR_CELLS - 1, Math.floor(y / yStep));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(COLOR_CELLS - 1, Math.floor(x / xStep));
      const i = (y * width + x) * 4;
      const idx = gy * COLOR_CELLS + gx;
      sumR[idx]! += rgba[i]!;
      sumG[idx]! += rgba[i + 1]!;
      sumB[idx]! += rgba[i + 2]!;
      counts[idx]! += 1;
    }
  }

  let out = '';
  for (let idx = 0; idx < cells; idx++) {
    const n = counts[idx]! > 0 ? counts[idx]! : 1;
    const r = Math.min(255, Math.max(0, Math.round(sumR[idx]! / n)));
    const g = Math.min(255, Math.max(0, Math.round(sumG[idx]! / n)));
    const b = Math.min(255, Math.max(0, Math.round(sumB[idx]! / n)));
    out +=
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0');
  }
  return out;
}

/** Hamming distance between two hex aHash strings (number of differing bits). */
export function hammingDistance(hashA: string, hashB: string): number {
  const a = BigInt('0x' + hashA);
  const b = BigInt('0x' + hashB);
  let diff = a ^ b;
  let count = 0;
  while (diff) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/**
 * L1 (Manhattan) distance between two color signatures: the sum of absolute
 * per-byte differences. Range is 0 (identical) to 3060 (12 bytes × 255).
 */
export function colorSignatureDistance(sigA: string, sigB: string): number {
  if (sigA.length !== sigB.length) {
    throw new Error(`color signature length mismatch: ${sigA.length} vs ${sigB.length}`);
  }
  let total = 0;
  for (let i = 0; i < sigA.length; i += 2) {
    const a = parseInt(sigA.slice(i, i + 2), 16);
    const b = parseInt(sigB.slice(i, i + 2), 16);
    total += Math.abs(a - b);
  }
  return total;
}

/** Default aHash tolerance: up to 10 of 64 bits may differ (≈15%). */
export const DEFAULT_TOLERANCE = 10;

/** Wider aHash tolerance for text rendering (font rasterization diverges more). */
export const TEXT_SCENE_TOLERANCE = 18;

/**
 * Default color-signature tolerance: total L1 distance across the 12 signature
 * bytes. ≈20 per byte on average — generous enough to absorb anti-aliasing and
 * gamma differences between WebGPU and wgpu, strict enough to flag a wrong hue.
 */
export const DEFAULT_COLOR_TOLERANCE = 240;

/** Wider color tolerance for text scenes. */
export const TEXT_COLOR_TOLERANCE = 360;
