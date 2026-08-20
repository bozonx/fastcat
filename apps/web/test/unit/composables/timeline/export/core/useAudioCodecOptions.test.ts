import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { useAudioCodecOptions } from '~/composables/timeline/export/core/useAudioCodecOptions';

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('~/composables/timeline/export/core/useExportCodecs', () => {
  const audioCodecSupport = ref({
    aac: true,
    opus: true,
    flac: false,
    pcm: true,
    mp3: false,
  });

  return {
    useExportCodecs: vi.fn(() => ({
      audioCodecSupport,
      isLoadingCodecSupport: ref(false),
      loadCodecSupport: vi.fn(),
    })),
  };
});

describe('useAudioCodecOptions', () => {
  it('disables every codec except opus for webm', () => {
    const wrapper = mount({
      setup() {
        const { audioCodecOptions } = useAudioCodecOptions({
          format: 'webm',
          disableByFormat: true,
        });
        return { audioCodecOptions };
      },
      template: '<div />',
    });

    const options = wrapper.vm.audioCodecOptions as Array<{
      value: string;
      disabled: boolean;
    }>;
    const opus = options.find((o) => o.value === 'opus');
    const aac = options.find((o) => o.value === 'aac');
    const pcm = options.find((o) => o.value === 'pcm');

    expect(opus?.disabled).toBe(false);
    expect(aac?.disabled).toBe(true);
    expect(pcm?.disabled).toBe(true);
  });

  it('disables flac and pcm for mp4', () => {
    const wrapper = mount({
      setup() {
        const { audioCodecOptions } = useAudioCodecOptions({
          format: 'mp4',
          disableByFormat: true,
        });
        return { audioCodecOptions };
      },
      template: '<div />',
    });

    const options = wrapper.vm.audioCodecOptions as Array<{
      value: string;
      disabled: boolean;
    }>;

    expect(options.find((o) => o.value === 'aac')?.disabled).toBe(false);
    expect(options.find((o) => o.value === 'opus')?.disabled).toBe(false);
    expect(options.find((o) => o.value === 'pcm')?.disabled).toBe(true);
  });

  it('does not apply format filtering when disableByFormat is false', () => {
    const wrapper = mount({
      setup() {
        const { audioCodecOptions } = useAudioCodecOptions({
          format: 'webm',
          disableByFormat: false,
        });
        return { audioCodecOptions };
      },
      template: '<div />',
    });

    const options = wrapper.vm.audioCodecOptions as Array<{
      value: string;
      disabled: boolean;
    }>;

    expect(options.find((o) => o.value === 'aac')?.disabled).toBe(false);
    expect(options.find((o) => o.value === 'opus')?.disabled).toBe(false);
  });
});
