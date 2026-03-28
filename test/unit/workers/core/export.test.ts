import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMetadata } from '~/workers/core/export';

// Use variables that can be modified per test
const mockFunctions = {
  getPrimaryVideoTrack: vi.fn(),
  computeDuration: vi.fn(),
};

vi.mock('mediabunny', () => ({
  Input: class {
    getMimeType = vi.fn().mockResolvedValue('video/mp4');
    getFormat = vi.fn().mockResolvedValue({ name: 'mp4' });
    computeDuration = (...args: any[]) => mockFunctions.computeDuration(...args);
    getPrimaryVideoTrack = (...args: any[]) => mockFunctions.getPrimaryVideoTrack(...args);
    getPrimaryAudioTrack = vi.fn().mockResolvedValue({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      computePacketStats: vi.fn().mockResolvedValue({ averageBitrate: 192000 }),
      getCodecParameterString: vi.fn().mockResolvedValue('mp4a.40.2'),
    });
  },
  BlobSource: class {
      constructor(public blob: Blob) {}
  },
  ALL_FORMATS: {},
}));

describe('extractMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFunctions.computeDuration.mockResolvedValue(10);
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue({
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
  });

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
    expect(meta.video).toMatchObject({
        width: 1920,
        fps: 30,
        codec: 'avc1.640028'
    });
    expect(meta.audio).toMatchObject({
        sampleRate: 48000,
        channels: 2
    });
  });

  it('extracts metadata for audio-only file', async () => {
    const file = new File([], 'test.mp3');
    mockFunctions.getPrimaryVideoTrack.mockResolvedValue(null);

    const meta = await extractMetadata(file);
    expect(meta.video).toBeUndefined();
    expect(meta.audio).toBeDefined();
    expect(meta.duration).toBe(10);
  });

  it('handles mediabunny failure gracefully', async () => {
    const file = new File([], 'error.mp4');
    mockFunctions.computeDuration.mockRejectedValue(new Error('Decode error'));

    await expect(extractMetadata(file)).rejects.toThrow('Decode error');
  });
});
