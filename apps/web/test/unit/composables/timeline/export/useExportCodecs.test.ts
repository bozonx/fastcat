/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { useExportCodecs } from '~/composables/timeline/export/core/useExportCodecs';

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('~/utils/webcodecs', () => ({
  BASE_VIDEO_CODEC_OPTIONS: [
    { value: 'avc1.640032', label: 'H.264' },
    { value: 'vp09.00.10.08', label: 'VP9' },
  ],
  checkVideoCodecSupport: vi.fn(() =>
    Promise.resolve({ 'avc1.640032': true, 'vp09.00.10.08': false }),
  ),
  checkAudioCodecSupport: vi.fn(() => Promise.resolve({ 'mp4a.40.2': true, opus: true })),
}));

describe('useExportCodecs', () => {
  it('initializes with default codec support', () => {
    const { videoCodecSupport, audioCodecSupport, isLoadingCodecSupport } = useExportCodecs();
    expect(videoCodecSupport.value).toEqual({});
    expect(audioCodecSupport.value).toEqual({
      aac: true,
      opus: true,
      flac: false,
      pcm: true,
      mp3: false,
    });
    expect(isLoadingCodecSupport.value).toBe(false);
  });

  it('loadCodecSupport updates video and audio support', async () => {
    const { loadCodecSupport, videoCodecSupport } = useExportCodecs();
    await loadCodecSupport();
    expect(videoCodecSupport.value).toEqual({
      'avc1.640032': true,
      'vp09.00.10.08': false,
    });
  });

  it('loadCodecSupport sets isLoadingCodecSupport during load', async () => {
    const { loadCodecSupport, isLoadingCodecSupport } = useExportCodecs();
    expect(isLoadingCodecSupport.value).toBe(false);
    const promise = loadCodecSupport();
    expect(isLoadingCodecSupport.value).toBe(true);
    await promise;
    expect(isLoadingCodecSupport.value).toBe(false);
  });

  it('loadCodecSupport does not run twice concurrently', async () => {
    const { loadCodecSupport, isLoadingCodecSupport } = useExportCodecs();
    const p1 = loadCodecSupport();
    const p2 = loadCodecSupport();
    await Promise.all([p1, p2]);
    // Both should complete without error
    expect(isLoadingCodecSupport.value).toBe(false);
  });
});
