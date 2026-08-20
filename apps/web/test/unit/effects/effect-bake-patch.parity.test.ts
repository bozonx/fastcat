/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchBakedEffectSpecs, type ClipBakedEffects } from '~/effects/animation-bake';

/**
 * Cross-engine parity contract — pairs with the Rust test
 * `monitor::scene::build::animation::tests::patch_baked_specs_matches_shared_parity_fixture`.
 */
interface EffectBakeCase {
  name: string;
  baked: ClipBakedEffects;
  atTicks: number;
  expected: Record<string, unknown>[];
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'shared/parity/effect-bake-patch.cases.json'), 'utf8'),
) as { cases: EffectBakeCase[] };

describe('effect-bake-patch parity (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const got = patchBakedEffectSpecs(c.baked, c.atTicks) as unknown as Record<string, unknown>[];
      expect(got).toEqual(c.expected);
    });
  }
});
