import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { linearToLevelDb } from '~/utils/audio/level-db';

/**
 * Cross-engine parity contract. This test and the Rust test
 * `audio::mix::tests::level_to_db_matches_shared_parity_fixture` read the SAME
 * fixture, so the web `linearToLevelDb` (feeding `AudioLevelMeter.getLevels`)
 * and the native `linear_to_level_db` (feeding the IPC-emitted levels in
 * src-tauri/src/audio/mix.rs) can never drift apart — the monitor's web and
 * native level meters stay calibrated to the same dBFS scale.
 */
interface LevelDbCase {
  name: string;
  value: number;
  db: number;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/audio-level-db.cases.json'), 'utf8'),
) as { epsilon: number; cases: LevelDbCase[] };

describe('audio level-dB parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(`matches native for "${c.name}"`, () => {
      expect(linearToLevelDb(c.value)).toBeCloseTo(c.db, 9);
    });
  }
});
