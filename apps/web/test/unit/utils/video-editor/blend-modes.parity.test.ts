import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBlendMode } from '~/utils/video-editor/compositor/types';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `compositor::scene::tests::blend_modes_match_shared_parity_fixture`. The set of
 * supported blend modes must be identical on both engines.
 */
const fixture = JSON.parse(readFileSync(resolveSharedPath('parity/blend-modes.json'), 'utf8')) as {
  modes: string[];
};

describe('blend-mode set parity (shared fixture)', () => {
  it('web supports every fixture mode (round-trips unchanged)', () => {
    for (const mode of fixture.modes) {
      expect(resolveBlendMode(mode)).toBe(mode);
    }
  });

  it('web supports no modes outside the fixture set', () => {
    // Any value not in the fixture must fall back to 'normal'.
    expect(resolveBlendMode('not-a-real-mode')).toBe('normal');
    expect(resolveBlendMode(undefined)).toBe('normal');
  });
});
