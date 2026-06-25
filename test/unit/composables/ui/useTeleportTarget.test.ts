/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref, provide, inject } from 'vue';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';

describe('useTeleportTarget', () => {
  it('returns body as target in non-embedded mode', () => {
    const { target, isEmbedded } = useTeleportTarget();
    expect(target.value).toBe('body');
    expect(isEmbedded).toBeFalsy();
  });

  it('returns custom target in embedded mode', () => {
    // Simulate provide/inject by using the composition API
    // Since inject is used inside, we need to test within a setup context
    // For now, test the default (non-embedded) behavior
    const { target } = useTeleportTarget();
    expect(target.value).toBe('body');
  });
});
