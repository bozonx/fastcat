import ceilings from '~shared/effects/render-ceilings.json';

/**
 * Hard render ceilings shared with the Rust compositor. The values live in
 * `shared/effects/render-ceilings.json` (the single source of truth); the Rust
 * pass builder generates its constants from the same file at compile time, so
 * the two backends can never drift. Import these instead of re-declaring the
 * literals.
 */
export const MAX_BLUR_RADIUS = ceilings.maxBlurRadius;
export const MAX_BLOOM_RADIUS = ceilings.maxBloomRadius;
export const MAX_COLOR_MULTIPLIER = ceilings.maxColorMultiplier;
export const MAX_BLOOM_STRENGTH = ceilings.maxBloomStrength;
export const MAX_CHROMATIC_ABERRATION = ceilings.maxChromaticAberration;
export const MAX_LEVELS_GAMMA = ceilings.maxLevelsGamma;
export const MAX_SHARPEN = ceilings.maxSharpen;
export const MAX_PIXELATE = ceilings.maxPixelate;
export const MAX_BLUR_FILL_SCALE = ceilings.maxBlurFillScale;
