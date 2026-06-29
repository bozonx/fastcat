/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chooseEvictionVictimTime } from '~/utils/video-editor/compositor/VideoFrameCache';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `monitor::frame_cache::tests::eviction_victim_matches_shared_parity_fixture` read
 * the SAME fixture, so the web `chooseEvictionVictimTime` and the native
 * `choose_eviction_victim` can never drift apart on the scrub-locality eviction
 * heuristic that keeps monitor playback smooth.
 */
interface ParityCase {
  name: string;
  frameTicks: number[];
  requestTick: number;
  expectedVictimTick: number;
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/frame-cache-eviction.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

describe('frame-cache eviction parity (shared fixture)', () => {
  it('has cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      expect(chooseEvictionVictimTime(c.frameTicks, c.requestTick)).toBe(c.expectedVictimTick);
    });
  }
});

describe('chooseEvictionVictimTime core', () => {
  it('returns null for an empty cache', () => {
    expect(chooseEvictionVictimTime([], 0)).toBeNull();
  });

  it('normalizes negative / fractional inputs the way the cache stores them', () => {
    // Times are rounded and floored at 0, matching CachedVideoFrameEntry.timelineTimeUs.
    expect(chooseEvictionVictimTime([-5, 1000.4], 0)).toBe(1000);
    expect(chooseEvictionVictimTime([0, 10], -100)).toBe(10);
  });
});
