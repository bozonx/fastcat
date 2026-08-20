import { resolveSharedPath } from 'test/fixtures/shared-path';
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNativeExportOptions } from '~/composables/timeline/export/core/useExportProcess';
import type { ExportOptions } from '~/types/worker-payload';

/**
 * Cross-boundary parity contract. This test and the Rust test
 * `media::timeline_export::tests::native_export_options_match_shared_parity_fixture`
 * read the SAME fixture, so the web `buildNativeExportOptions` output and the native
 * `NativeExportOptions` serde shape can never drift apart: a renamed key on either
 * side breaks a test instead of silently dropping an export option over the IPC.
 */
interface ParityCase {
  name: string;
  webInput: {
    options: ExportOptions & { audioSampleRate: number };
    rangeStartTicks: number;
    rangeEndTicks: number;
  };
  native: Record<string, unknown>;
}

const fixture = JSON.parse(
  readFileSync(resolveSharedPath('parity/export-options.cases.json'), 'utf8'),
) as { cases: ParityCase[] };

describe('export-options parity (shared fixture)', () => {
  it('has cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`buildNativeExportOptions matches native for "${c.name}"`, () => {
      const result = buildNativeExportOptions({
        options: c.webInput.options,
        rangeStartTicks: c.webInput.rangeStartTicks,
        rangeEndTicks: c.webInput.rangeEndTicks,
      });
      expect(result).toEqual(c.native);
    });
  }
});
