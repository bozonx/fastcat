import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaElementGain } from '~/composables/preview/useMediaElementGain';

function mountHarness(options: { audioContext?: unknown; initialVolume?: number } = {}) {
  if ('audioContext' in options) {
    (window as unknown as { AudioContext?: unknown }).AudioContext = options.audioContext;
  } else {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  }

  const audio = document.createElement('audio');
  const gainNode = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const component = mount(
    defineComponent({
      setup() {
        const mediaElement = ref<HTMLAudioElement | null>(audio);
        const volume = ref(options.initialVolume ?? 4);
        const isMuted = ref(false);
        const gain = useMediaElementGain(mediaElement, volume, isMuted, { maxGain: 2 });

        return {
          audio,
          gain,
          gainNode,
          isMuted,
          mediaElement,
          sourceNode,
          volume,
        };
      },
      template: '<div />',
    }),
  );

  return { audio, component, gainNode, sourceNode };
}

describe('useMediaElementGain', () => {
  afterEach(() => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    vi.restoreAllMocks();
  });

  it('uses Web Audio gain for preview amplification above native media volume', async () => {
    const gainNode = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const createMediaElementSource = vi.fn(() => sourceNode);

    class FakeAudioContext {
      state = 'running';
      destination = {};
      createGain = vi.fn(() => gainNode);
      createMediaElementSource = createMediaElementSource;
      close = vi.fn().mockResolvedValue(undefined);
      resume = vi.fn().mockResolvedValue(undefined);
    }

    const { audio, component } = mountHarness({
      audioContext: FakeAudioContext,
      initialVolume: 4,
    });

    await nextTick();

    expect(createMediaElementSource).toHaveBeenCalledWith(audio);
    expect(sourceNode.connect).toHaveBeenCalledWith(gainNode);
    expect(gainNode.connect).toHaveBeenCalled();
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBe(false);
    expect(gainNode.gain.value).toBe(2);

    component.vm.isMuted = true;
    await nextTick();

    expect(gainNode.gain.value).toBe(0);
  });

  it('falls back to native media volume when Web Audio is unavailable', async () => {
    const { audio, component } = mountHarness({ initialVolume: 4 });

    await nextTick();

    expect(audio.volume).toBe(1);
    expect(audio.muted).toBe(false);

    component.vm.volume = 0.35;
    component.vm.isMuted = true;
    await nextTick();

    expect(audio.volume).toBe(0.35);
    expect(audio.muted).toBe(true);
  });
});
