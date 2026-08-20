import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  VideoFrameCache,
  computeFrameKeyMs,
  buildVideoFrameCacheKey,
} from '~/utils/video-editor/compositor/VideoFrameCache';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `monitor::frame_cache::tests::frame_le_matches_shared_parity_fixture` read the SAME
 * fixture, so the web `VideoFrameCache.frameLe` and the native
 * `VideoFrameCache::frame_le_with_max_lag` can never drift apart on the VFR-safe
 * sample-and-hold lookup that keeps the wrong/duplicate frame off the screen.
 */
interface ParityCase {
  name: string;
  framePtsMs: number[];
  targetMs: number;
  maxLagMs: number;
  expectedPtsMs: number | null;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/frame-le-sample-hold.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

function makeFrame(): VideoFrame {
  return { close: vi.fn(), closed: false, codedWidth: 4, codedHeight: 4 } as unknown as VideoFrame;
}

function cacheWith(framePtsMs: number[]): VideoFrameCache {
  const cache = new VideoFrameCache(100 * 1024 * 1024);
  for (const ptsMs of framePtsMs) {
    const keyMs = computeFrameKeyMs(ptsMs / 1000);
    cache.set({
      key: buildVideoFrameCacheKey({ itemId: 'clip' }, keyMs),
      clipId: 'clip',
      keyMs,
      timelineTimeTicks: 0,
      frame: makeFrame(),
      sizeBytes: 100,
      width: 4,
      height: 4,
    });
  }
  return cache;
}

describe('frame_le sample-and-hold parity (shared fixture)', () => {
  it('has cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      const cache = cacheWith(c.framePtsMs);
      const served = cache.frameLe('clip', c.targetMs / 1000, c.maxLagMs / 1000);
      expect(served ? served.keyMs : null).toBe(c.expectedPtsMs);
    });
  }
});
