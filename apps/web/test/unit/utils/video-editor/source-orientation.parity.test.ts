import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceOrientationToDeg } from '~/utils/video-editor/worker-clip-utils';
import type { ClipSourceOrientation } from '~/timeline/types';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `monitor::scene::build::transform::tests::source_orientation_deg_matches_shared_parity_fixture`.
 */
interface OrientationCase {
  orientation: string | null;
  expected: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/source-orientation-deg.cases.json'), 'utf8'),
) as { cases: OrientationCase[] };

describe('source-orientation parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.orientation}"`, () => {
      const value = (c.orientation ?? undefined) as ClipSourceOrientation | undefined;
      expect(sourceOrientationToDeg(value)).toBe(c.expected);
    });
  }
});
