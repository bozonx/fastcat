import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { getBunnyAudioCodec } from './utils';
import { AudioMixer } from './AudioMixer';
import type { AudioMixerPrepareParams } from './AudioMixer';

const OPUS_SAMPLE_RATE = 48000;

function resolveMixSampleRate(options: { audioSampleRate?: number; audioCodec?: string }): number {
  const codec = String(options.audioCodec ?? '').toLowerCase();
  if (codec === 'opus') return OPUS_SAMPLE_RATE;

  const sampleRate = Number(options.audioSampleRate);
  if (!Number.isFinite(sampleRate)) return OPUS_SAMPLE_RATE;
  return Math.min(192000, Math.max(8000, Math.round(sampleRate)));
}

export async function buildMixedAudioTrack(
  options: {
    audioSampleRate?: number;
    audioChannels?: 'mono' | 'stereo';
    audioCodec?: string;
    audioBitrate?: number;
  },
  audioClips: AudioMixerPrepareParams['audioClips'],
  durationS: number,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (message: string) => Promise<void>,
  checkCancel?: () => boolean,
  masterAudioEffects?: import('../../utils/audio/apply-audio-effects-offline').AudioEffectData[],
) {
  const { AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = resolveMixSampleRate(options);
  const numberOfChannels = options.audioChannels === 'mono' ? 1 : 2;

  const prepared = await AudioMixer.prepareClips({
    audioClips,
    hostClient,
    reportExportWarning,
    checkCancel,
    mediabunny: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AudioSampleSink: AudioSampleSink as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Input: Input as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      BlobSource: BlobSource as any,
      ALL_FORMATS,
    },
  });

  if (prepared.length === 0) return null;

  const audioSource = new AudioSampleSource({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codec: getBunnyAudioCodec(options.audioCodec === 'mulaw' ? 'mulaw' : options.audioCodec) as any,
    bitrate: options.audioBitrate,
  });

  const chunkDurationS = 1;

  async function writeMixedToSource(onProgress?: (progress: number) => void) {
    const { AudioSample } = await import('mediabunny');
    await AudioMixer.writeMixedToSource({
      prepared,
      durationS,
      audioSource,
      chunkDurationS,
      sampleRate,
      numberOfChannels,
      reportExportWarning,
      checkCancel,
      AudioSample,
      masterAudioEffects,
      onProgress,
    });
  }

  return {
    audioSource,
    writeMixedToSource,
    numberOfChannels,
    sampleRate,
  };
}
