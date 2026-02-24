import type { VideoCoreHostAPI } from '../../utils/video-editor/worker-client';
import { getBunnyAudioCodec } from './utils';
import { AudioMixer } from './AudioMixer';

export async function buildMixedAudioTrack(
  options: any,
  audioClips: any[],
  durationS: number,
  hostClient: VideoCoreHostAPI | null,
  reportExportWarning: (message: string) => Promise<void>,
  checkCancel?: () => boolean,
) {
  const { AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = 48000;
  const numberOfChannels = 2;

  const prepared = await AudioMixer.prepareClips({
    audioClips,
    hostClient,
    reportExportWarning,
    checkCancel,
    mediabunny: {
      AudioSampleSink,
      Input,
      BlobSource,
      ALL_FORMATS,
    },
  });

  if (prepared.length === 0) return null;

  const audioSource = new AudioSampleSource({
    codec: getBunnyAudioCodec(options.audioCodec),
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
