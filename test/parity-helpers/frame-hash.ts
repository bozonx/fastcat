/**
 * Perceptual hashing for cross-engine frame parity.
 *
 * The actual implementation lives in `~/utils/video-editor/perceptual-hash`
 * (the single source of truth shared with the web render page and the golden
 * scripts, and mirrored by the Rust engine). This module simply re-exports it
 * so the parity test helpers keep their historical import path.
 *
 * The hash is a 64-bit average hash (aHash):
 *   1. Downsample the RGBA frame to 8x8 grayscale (luminance).
 *   2. Compute the mean luminance of the 64 pixels.
 *   3. Each bit = 1 if pixel > mean, else 0.
 *
 * A companion 2x2 mean-color signature (`computeColorSignature`) catches hue
 * errors that the luminance-only aHash is blind to.
 */

export {
  computeFrameHash,
  computeColorSignature,
  hammingDistance,
  colorSignatureDistance,
  DEFAULT_TOLERANCE,
  TEXT_SCENE_TOLERANCE,
  DEFAULT_COLOR_TOLERANCE,
  TEXT_COLOR_TOLERANCE,
} from '../../src/utils/video-editor/perceptual-hash';
