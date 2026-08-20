/** @vitest-environment node */
import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { createGroupedWarningReporter } from '~/utils/grouped-warnings';

describe('createGroupedWarningReporter', () => {
  it('groups repeated warnings and keeps distinct messages', () => {
    const warnings = ref<string[]>([]);
    const report = createGroupedWarningReporter(warnings);

    report('decode failed');
    report('audio warning');
    report('decode failed');

    expect(warnings.value).toEqual(['decode failed (x2)', 'audio warning']);
  });

  it('ignores blank warning messages', () => {
    const warnings = ref<string[]>([]);
    const report = createGroupedWarningReporter(warnings);

    report('   ');

    expect(warnings.value).toEqual([]);
  });
});
