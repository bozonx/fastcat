/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  loadGoldenRegistry,
  findGoldenEntry,
  findGoldenSample,
  compareHash,
  upsertGoldenSample,
  type GoldenRegistry,
} from './golden-compare';

describe('golden-compare', () => {
  it('loads the shared golden registry', () => {
    const registry = loadGoldenRegistry();
    expect(registry.entries).toBeInstanceOf(Array);
    expect(registry.entries.length).toBeGreaterThan(0);
  });

  it('finds golden entries by scene and engine', () => {
    const registry = loadGoldenRegistry();
    const web = findGoldenEntry(registry, 'solid-background.json', 'web');
    const native = findGoldenEntry(registry, 'solid-background.json', 'native');

    expect(web).toBeDefined();
    expect(native).toBeDefined();
    expect(web?.engine).toBe('web');
    expect(native?.engine).toBe('native');
  });

  it('returns undefined for unknown scenes', () => {
    const registry = loadGoldenRegistry();
    expect(findGoldenEntry(registry, 'nonexistent.json', 'web')).toBeUndefined();
  });

  it('finds golden samples by time', () => {
    const registry: GoldenRegistry = {
      entries: [
        {
          scene: 'solid-background.json',
          engine: 'web',
          samples: [{ timeSec: 0.5, hash: 'ffffffffffffffff', tolerance: 10 }],
        },
      ],
    };

    const sample = findGoldenSample(registry.entries[0]!, 0.5);
    expect(sample).toBeDefined();
    expect(sample?.hash).toBe('ffffffffffffffff');

    expect(findGoldenSample(registry.entries[0]!, 1.0)).toBeUndefined();
  });

  it('compares hashes with the correct Hamming distance', () => {
    const match = compareHash('ffffffffffffffff', 'ffffffffffffffff', 10);
    expect(match.pass).toBe(true);
    expect(match.distance).toBe(0);

    const mismatch = compareHash('ffffffffffffffff', '0000000000000000', 10);
    expect(mismatch.pass).toBe(false);
    expect(mismatch.distance).toBe(64);
  });

  it('upserts golden samples into a registry', () => {
    const registry: GoldenRegistry = { entries: [] };

    upsertGoldenSample(registry, 'scene.json', 'web', 0.5, 'aaaaaaaaaaaaaaaa', 10);
    expect(registry.entries).toHaveLength(1);
    expect(findGoldenSample(registry.entries[0]!, 0.5)?.hash).toBe('aaaaaaaaaaaaaaaa');

    upsertGoldenSample(registry, 'scene.json', 'web', 0.5, 'bbbbbbbbbbbbbbbb', 12);
    expect(registry.entries).toHaveLength(1);
    expect(findGoldenSample(registry.entries[0]!, 0.5)?.hash).toBe('bbbbbbbbbbbbbbbb');
    expect(findGoldenSample(registry.entries[0]!, 0.5)?.tolerance).toBe(12);
  });
});
