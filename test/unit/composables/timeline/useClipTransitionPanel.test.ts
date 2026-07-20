/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipTransitionPanel } from '~/composables/timeline/useClipTransitionPanel';
import type { ClipTransition } from '~/timeline/types';
import { initTransitions, registerTransition } from '~/transitions';

describe('useClipTransitionPanel', () => {
  initTransitions();
  it('emits update when selectedType changes', async () => {
    const onUpdate = vi.fn();

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('in'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'dissolve',
        durationTicks: 254_016_000_000,
        mode: 'fade',
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

  it('persists a manually selected source mode', async () => {
    const onUpdate = vi.fn();
    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('out'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'dissolve',
        durationTicks: 254_016_000_000,
        mode: 'adjacent',
        curve: 'linear',
      }),
      onUpdate,
    });

    api.selectedMode.value = 'background';
    await Promise.resolve();

    expect(onUpdate).toHaveBeenLastCalledWith({
      trackId: 'v1',
      itemId: 'c1',
      edge: 'out',
      transition: expect.objectContaining({
        mode: 'background',
        isOverridden: true,
      }),
    });
  });

  it('emits normalized params for selected transition type', async () => {
    const onUpdate = vi.fn();

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('in'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'wipe',
        durationTicks: 254_016_000_000,
        mode: 'transition',
        curve: 'linear',
        params: {
          direction: 'up',
          edgeMode: 'gap',
          gap: 0.03,
          gapColor: '#ff00ff',
        },
      }),
      onUpdate,
      debounceMs: 0,
    });

    api.updateParam('gap', 0.05);
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      transition: {
        type: 'wipe',
        mode: 'transition',
        params: {
          direction: 'up',
          edgeMode: 'gap',
          gap: 0.05,
          gapColor: '#ff00ff',
          blur: 2,
        },
      },
    });
  });

  it('applies a custom transition preset as the base transition type', async () => {
    const onUpdate = vi.fn();

    registerTransition({
      type: 'custom_wipe_fast',
      name: 'Fast Wipe',
      icon: 'i-test',
      baseType: 'wipe',
      isCustom: true,
      defaultDurationTicks: 127_008_000_000,
      defaultParams: {
        direction: 'left',
        edgeMode: 'gap',
        gap: 0.08,
        gapColor: '#00ff00',
      },
      computeInOpacity: () => 1,
      computeOutOpacity: () => 1,
    });

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('in'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'dissolve',
        durationTicks: 254_016_000_000,
        mode: 'transparent',
        curve: 'linear',
      }),
      onUpdate,
      debounceMs: 0,
    });

    api.selectedType.value = 'custom_wipe_fast';
    await Promise.resolve();

    expect(onUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      transition: {
        type: 'wipe',
        params: {
          direction: 'left',
          edgeMode: 'gap',
          gap: 0.08,
          gapColor: '#00ff00',
          blur: 2,
        },
      },
    });
  });

  it('clamps durationSec when durationMax decreases below it', async () => {
    const onUpdate = vi.fn();
    const maxDuration = ref(3);

    const api = useClipTransitionPanel({
      edge: ref<'in' | 'out'>('in'),
      trackId: ref('v1'),
      itemId: ref('c1'),
      transition: ref<ClipTransition | undefined>({
        type: 'dissolve',
        durationTicks: 508_032_000_000,
        mode: 'adjacent',
        curve: 'linear',
      }),
      maxDuration,
      onUpdate,
      debounceMs: 0,
    });

    expect(api.durationSec.value).toBe(2);

    // Decrease max duration below 2 seconds (e.g. to 0.5 seconds)
    maxDuration.value = 0.5;
    await Promise.resolve();

    expect(api.durationSec.value).toBe(0.5);
    expect(onUpdate).toHaveBeenCalled();
    expect(onUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      transition: expect.objectContaining({
        durationTicks: 127_008_000_000,
      }),
    });
  });
});
