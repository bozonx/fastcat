/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { useVideoCodecs } from '~/composables/useVideoCodecs';
import {
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
  BASE_VIDEO_CODEC_OPTIONS,
} from '~/utils/webcodecs';

vi.mock('~/utils/webcodecs', () => ({
  BASE_VIDEO_CODEC_OPTIONS: [{ label: 'Codec 1', value: 'codec1' }],
  checkVideoCodecSupport: vi.fn(),
  resolveVideoCodecOptions: vi.fn(),
}));

describe('useVideoCodecs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default values and starts loading on mount', () => {
    vi.mocked(checkVideoCodecSupport).mockReturnValue(new Promise(() => {})); // Hangs forever
    vi.mocked(resolveVideoCodecOptions).mockReturnValue([]);

    const TestComponent = {
      template: '<div></div>',
      setup() {
        return useVideoCodecs();
      },
    };

    const wrapper = mount(TestComponent);

    // Initial state before promise resolves
    expect(wrapper.vm.isLoadingCodecSupport).toBe(true); // because onMounted triggered loadCodecSupport
    expect(wrapper.vm.videoCodecSupport).toEqual({});
  });

  it('loads codec support on mount and updates state', async () => {
    vi.mocked(checkVideoCodecSupport).mockResolvedValue({ codec1: true });
    vi.mocked(resolveVideoCodecOptions).mockReturnValue([
      { label: 'Codec 1', value: 'codec1', supported: true } as any,
    ]);

    const TestComponent = {
      template: '<div></div>',
      setup() {
        return useVideoCodecs();
      },
    };

    const wrapper = mount(TestComponent);

    // Wait for the async loadCodecSupport to finish
    await vi.waitFor(() => {
      expect(wrapper.vm.isLoadingCodecSupport).toBe(false);
    });

    expect(checkVideoCodecSupport).toHaveBeenCalledWith(BASE_VIDEO_CODEC_OPTIONS);
    expect(wrapper.vm.videoCodecSupport).toEqual({ codec1: true });
    expect(wrapper.vm.videoCodecOptions).toEqual([
      { label: 'Codec 1', value: 'codec1', supported: true },
    ]);
    expect(resolveVideoCodecOptions).toHaveBeenCalledWith(BASE_VIDEO_CODEC_OPTIONS, {
      codec1: true,
    });
  });

  it('does not load concurrently if already loading', async () => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise((res) => {
      resolvePromise = res;
    });
    vi.mocked(checkVideoCodecSupport).mockReturnValue(promise as any);

    const TestComponent = {
      template: '<div></div>',
      setup() {
        return useVideoCodecs();
      },
    };

    const wrapper = mount(TestComponent);

    expect(wrapper.vm.isLoadingCodecSupport).toBe(true);
    expect(checkVideoCodecSupport).toHaveBeenCalledTimes(1);

    // Try calling again directly
    const loadPromise = wrapper.vm.loadCodecSupport();

    // checkVideoCodecSupport should still only be called once
    expect(checkVideoCodecSupport).toHaveBeenCalledTimes(1);

    resolvePromise!({ codec1: false });
    await loadPromise;
    await vi.waitFor(() => {
      expect(wrapper.vm.isLoadingCodecSupport).toBe(false);
    });
  });

  it('resets loading state even if check fails', async () => {
    vi.mocked(checkVideoCodecSupport).mockRejectedValue(new Error('Test error'));

    const TestComponent = {
      template: '<div></div>',
      setup() {
        return useVideoCodecs();
      },
    };

    const wrapper = mount(TestComponent);

    await vi.waitFor(() => {
      expect(wrapper.vm.isLoadingCodecSupport).toBe(false);
    });

    expect(wrapper.vm.videoCodecSupport).toEqual({});
  });
});
