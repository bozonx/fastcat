import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { getBunnyAudioCodec } from './utils';
import { AudioMixer } from './AudioMixer';
import type { AudioMixerPrepareParams } from './AudioMixer';

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
) {
  const { AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = options.audioSampleRate || 48000;
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

  async function writeMixedToSource() {
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
    });
  }

  return {
    audioSource,
    writeMixedToSource,
    numberOfChannels,
    sampleRate,
  };
}
