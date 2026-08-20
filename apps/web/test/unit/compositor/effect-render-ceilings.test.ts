import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ceilings from '~/utils/video-editor/compositor/effect-render-ceilings';
import source from '~shared/effects/render-ceilings.json';

/**
 * The render ceilings are defined once in `shared/effects/render-ceilings.json`
 * and consumed by both backends (web imports the JSON; Rust generates its
 * constants from it in `build.rs`). These tests guard the web half: the
 * exported constants must equal the JSON, and the JSON/Rust mapping must list
 * exactly the same keys so neither side can silently drop a ceiling.
 */
const ceilingsJson = source as Record<string, number>;

const buildRs = readFileSync(resolve(process.cwd(), '../native/src-tauri/build.rs'), 'utf8');

const EXPECTED: Record<keyof typeof ceilings, string> = {
  MAX_BLUR_RADIUS: 'maxBlurRadius',
  MAX_BLOOM_RADIUS: 'maxBloomRadius',
  MAX_COLOR_MULTIPLIER: 'maxColorMultiplier',
  MAX_BLOOM_STRENGTH: 'maxBloomStrength',
  MAX_CHROMATIC_ABERRATION: 'maxChromaticAberration',
  MAX_LEVELS_GAMMA: 'maxLevelsGamma',
  MAX_SHARPEN: 'maxSharpen',
  MAX_PIXELATE: 'maxPixelate',
  MAX_BLUR_FILL_SCALE: 'maxBlurFillScale',
};

describe('effect render ceilings', () => {
  it('exports every constant from the shared JSON', () => {
    for (const [constName, jsonKey] of Object.entries(EXPECTED)) {
      const value = ceilingsJson[jsonKey];
      expect(value, `JSON missing ${jsonKey}`).toBeTypeOf('number');
      expect(value).toBeGreaterThan(0);
      expect(ceilings[constName as keyof typeof ceilings]).toBe(value);
    }
  });

  it('keeps the Rust build.rs mapping in lockstep with the JSON keys', () => {
    const jsonKeys = Object.keys(ceilingsJson)
      .filter((k) => !k.startsWith('_'))
      .sort();
    expect(jsonKeys).toEqual(Object.values(EXPECTED).sort());
    // Every JSON key must be wired into the Rust generator, else the native
    // side would miss a ceiling that the web side enforces.
    for (const jsonKey of jsonKeys) {
      expect(buildRs, `build.rs missing ${jsonKey}`).toContain(`"${jsonKey}"`);
    }
  });
});
