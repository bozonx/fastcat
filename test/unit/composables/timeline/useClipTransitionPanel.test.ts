import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipTransitionPanel } from '../../../../src/composables/timeline/useClipTransitionPanel';
import type { ClipTransition } from '../../../../src/timeline/types';

describe('useClipTransitionPanel', () => {
  it('emits update when selectedType changes', async () => {
    const onUpdate = vi.fn();

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('in'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'dissolve',
        durationUs: 1_000_000,
        mode: 'blend',
        curve: 'linear',
      }),
      maxDuration: ref(3),
      onUpdate,
      debounceMs: 0,
    });

    api.selectedType.value = 'wipe';
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      trackId: 'v1',
      itemId: 'c1',
      edge: 'in',
      transition: expect.objectContaining({
        type: 'wipe',
      }),
    });
  });

  it('remove emits null transition', () => {
    const onUpdate = vi.fn();

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('out'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>(undefined),
      onUpdate,
      debounceMs: 0,
    });

    api.remove();

    expect(onUpdate).toHaveBeenCalledWith({
      trackId: 'v1',
      itemId: 'c1',
      edge: 'out',
      transition: null,
    });
  });
});
