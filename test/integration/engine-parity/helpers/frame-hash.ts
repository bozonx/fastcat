/**
 * Perceptual hashing for cross-engine frame parity.
 *
 * The hash is a 64-bit average hash (aHash):
 *   1. Downsample the RGBA frame to 8x8 grayscale (luminance).
 *   2. Compute the mean luminance of the 64 pixels.
 *   3. Each bit = 1 if pixel > mean, else 0.
 *
 * This produces a compact fingerprint that is:
 *   - Tolerant to sub-pixel rasterization differences between WebGPU and wgpu.
 *   - Sensitive to structural/content changes (wrong color, missing layer, etc.).
 *   - Comparable via Hamming distance (number of differing bits).
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

/** Compute the 64-bit average hash as a hex string (16 chars). */
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

/** Hamming distance between two hex hash strings. */
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

/** Default tolerance: up to 10 of 64 bits may differ (≈15%). */
export const DEFAULT_TOLERANCE = 10;

/** Wider tolerance for text rendering (font rasterization diverges more). */
export const TEXT_SCENE_TOLERANCE = 18;
