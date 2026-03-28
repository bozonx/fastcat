import { describe, it, expect, vi } from 'vitest';
import { extractMetadata } from '~/workers/core/export';

vi.mock('mediabunny', () => ({
  Input: class {
    getMimeType = vi.fn().mockResolvedValue('video/mp4');
    getFormat = vi.fn().mockResolvedValue({ name: 'mp4' });
    computeDuration = vi.fn().mockResolvedValue(10);
    getPrimaryVideoTrack = vi.fn().mockResolvedValue({
      codedWidth: 1920,
      codedHeight: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      codec: 'avc1.640028',
      computePacketStats: vi.fn().mockResolvedValue({ averagePacketRate: 30, averageBitrate: 5000000 }),
      getCodecParameterString: vi.fn().mockResolvedValue('avc1.640028'),
      getColorSpace: vi.fn().mockResolvedValue({}),
    });
    getPrimaryAudioTrack = vi.fn().mockResolvedValue({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      computePacketStats: vi.fn().mockResolvedValue({ averageBitrate: 192000 }),
      getCodecParameterString: vi.fn().mockResolvedValue('mp4a.40.2'),
    });
  },
  BlobSource: class {},
  ALL_FORMATS: {},
}));

describe('extractMetadata', () => {
  it('extracts metadata for image file', async () => {
    const file = new File([], 'test.jpg');
    const meta = await extractMetadata(file);

    expect(meta.container).toBe('image');
    expect(meta.duration).toBe(0);
    expect(meta.mimeType).toBe('image/jpeg');
  });

  it('extracts metadata for video file using mediabunny', async () => {
    const file = new File([], 'test.mp4');
    const meta = await extractMetadata(file);

    expect(meta.duration).toBe(10);
    expect(meta.container).toBe('mp4');
    expect(meta.video?.width).toBe(1920);
    expect(meta.video?.fps).toBe(30);
    expect(meta.audio?.sampleRate).toBe(48000);
    expect(meta.audio?.channels).toBe(2);
  });

  it('extracts metadata for audio-only file', async () => {
    const file = new File([], 'test.mp3');
    // Mock video track to null for this test
    const InputMock = (await import('mediabunny')).Input;
    const originalGetPrimaryVideoTrack = InputMock.prototype.getPrimaryVideoTrack;
    InputMock.prototype.getPrimaryVideoTrack = vi.fn().mockResolvedValue(null);

    try {
      const meta = await extractMetadata(file);
      expect(meta.video).toBeUndefined();
      expect(meta.audio).toBeDefined();
      expect(meta.duration).toBe(10);
    } finally {
      InputMock.prototype.getPrimaryVideoTrack = originalGetPrimaryVideoTrack;
    }
  });

  it('handles mediabunny failure gracefully', async () => {
    const file = new File([], 'error.mp4');
    const InputMock = (await import('mediabunny')).Input;
    const originalComputeDuration = InputMock.prototype.computeDuration;
    InputMock.prototype.computeDuration = vi.fn().mockRejectedValue(new Error('Decode error'));

    try {
      await expect(extractMetadata(file)).rejects.toThrow('Decode error');
    } finally {
      InputMock.prototype.computeDuration = originalComputeDuration;
    }
  });
});
