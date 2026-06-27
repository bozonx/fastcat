import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hammingDistance, colorSignatureDistance, DEFAULT_COLOR_TOLERANCE } from './frame-hash';

/**
 * Golden hash registry — maps scene + sample time to an expected perceptual
 * hash and tolerance. Loaded from `shared/golden/frames.json`.
 */
export interface GoldenSample {
  timeSec: number;
  hash: string;
  tolerance: number;
  /**
   * 2x2 mean-color signature (24 hex chars). Optional for backwards
   * compatibility with goldens captured before color signatures existed;
   * comparisons that involve a sample without `colorSig` skip the color check.
   */
  colorSig?: string;
}

export interface GoldenEntry {
  scene: string;
  engine: 'web' | 'native';
  samples: GoldenSample[];
}

export interface GoldenRegistry {
  entries: GoldenEntry[];
}

const GOLDEN_PATH = resolve(process.cwd(), 'shared/golden/frames.json');

/** Load the golden hash registry. */
export function loadGoldenRegistry(): GoldenRegistry {
  const raw = readFileSync(GOLDEN_PATH, 'utf8');
  return JSON.parse(raw) as GoldenRegistry;
}

/** Save the golden hash registry (used by the generator script). */
export function saveGoldenRegistry(registry: GoldenRegistry): void {
  writeFileSync(GOLDEN_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

/** Find the golden entry for a scene + engine. */
export function findGoldenEntry(
  registry: GoldenRegistry,
  scene: string,
  engine: 'web' | 'native',
): GoldenEntry | undefined {
  return registry.entries.find((e) => e.scene === scene && e.engine === engine);
}

/** Find the golden sample for a specific time within an entry. */
export function findGoldenSample(entry: GoldenEntry, timeSec: number): GoldenSample | undefined {
  return entry.samples.find((s) => Math.abs(s.timeSec - timeSec) < 1e-6);
}

export interface GoldenMatchResult {
  pass: boolean;
  actualHash: string;
  expectedHash: string;
  distance: number;
  tolerance: number;
}

/**
 * Compare an actual hash against the golden expectation.
 * Returns a structured result so the test can report a useful diff.
 */
export function compareHash(
  actualHash: string,
  expectedHash: string,
  tolerance: number,
): GoldenMatchResult {
  const distance = hammingDistance(actualHash, expectedHash);
  return {
    pass: distance <= tolerance,
    actualHash,
    expectedHash,
    distance,
    tolerance,
  };
}

export interface ColorMatchResult {
  pass: boolean;
  actualSig: string;
  expectedSig: string;
  distance: number;
  tolerance: number;
}

/**
 * Compare an actual color signature against the golden expectation using L1
 * distance. Catches hue errors the luminance-only aHash is blind to.
 */
export function compareColorSig(
  actualSig: string,
  expectedSig: string,
  tolerance: number = DEFAULT_COLOR_TOLERANCE,
): ColorMatchResult {
  const distance = colorSignatureDistance(actualSig, expectedSig);
  return { pass: distance <= tolerance, actualSig, expectedSig, distance, tolerance };
}

/**
 * Upsert a golden sample into the registry (in-memory).
 * Call `saveGoldenRegistry` to persist.
 */
export function upsertGoldenSample(
  registry: GoldenRegistry,
  scene: string,
  engine: 'web' | 'native',
  timeSec: number,
  hash: string,
  tolerance: number = 10,
  colorSig?: string,
): void {
  let entry = findGoldenEntry(registry, scene, engine);
  if (!entry) {
    entry = { scene, engine, samples: [] };
    registry.entries.push(entry);
  }

  const existing = findGoldenSample(entry, timeSec);
  if (existing) {
    existing.hash = hash;
    existing.tolerance = tolerance;
    if (colorSig) existing.colorSig = colorSig;
  } else {
    entry.samples.push({ timeSec, hash, tolerance, ...(colorSig ? { colorSig } : {}) });
  }
}
