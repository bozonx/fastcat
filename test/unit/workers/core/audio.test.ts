import { describe, it, expect, vi } from 'vitest';
import { buildMixedAudioTrack } from '~/workers/core/audio';
import { AudioMixer } from '~/workers/core/AudioMixer';

vi.mock('mediabunny', () => ({
  AudioSampleSink: class {},
  AudioSampleSource: class {
    add = vi.fn();
  },
  Input: class {
    getPrimaryAudioTrack = vi.fn().mockResolvedValue({
      canDecode: vi.fn().mockResolvedValue(true),
    });
  },
  BlobSource: class {},
  ALL_FORMATS: {},
  AudioSample: class {},
}));

vi.mock('~/workers/core/AudioMixer', () => ({
  AudioMixer: {
    prepareClips: vi.fn(),
    writeMixedToSource: vi.fn(),
  },
}));

describe('buildMixedAudioTrack', () => {
  it('prepares and mixes audio track', async () => {
    const audioClips = [
      {
        sourcePath: 'test.mp3',
        startUs: 0,
        durationUs: 1000000,
      },
    ];

    (AudioMixer.prepareClips as any).mockResolvedValue([{ id: 'prepared-clip' }]);

    const result = await buildMixedAudioTrack(
      { audioSampleRate: 48000, audioChannels: 'stereo' },
      audioClips as any,
      10,
      null,
      vi.fn(),
    );

    expect(result).not.toBeNull();
    expect(result?.sampleRate).toBe(48000);
    expect(result?.numberOfChannels).toBe(2);
    expect(AudioMixer.prepareClips).toHaveBeenCalled();

    if (result) {
      await result.writeMixedToSource();
      expect(AudioMixer.writeMixedToSource).toHaveBeenCalledWith(
        expect.objectContaining({
          prepared: [{ id: 'prepared-clip' }],
          durationS: 10,
          sampleRate: 48000,
          numberOfChannels: 2,
        }),
      );
    }
  });

  it('returns null if no clips are prepared', async () => {
    (AudioMixer.prepareClips as any).mockResolvedValue([]);

    const result = await buildMixedAudioTrack(
      {},
      [] as any,
      10,
      null,
      vi.fn(),
    );

    expect(result).toBeNull();
  });
});
