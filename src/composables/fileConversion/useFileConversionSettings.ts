import { reactive, ref } from 'vue';
import {
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_CODEC,
  DEFAULT_VIDEO_BITRATE_MBPS,
  DEFAULT_AUDIO_CODEC,
  DEFAULT_AUDIO_BITRATE_KBPS,
  DEFAULT_KEYFRAME_INTERVAL_SEC,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_VIDEO_FPS,
  DEFAULT_AUDIO_ONLY_FORMAT,
  DEFAULT_IMAGE_QUALITY,
} from '~/utils/conversion/constants';

export function useFileConversionSettings() {
  const video = reactive({
    format: DEFAULT_VIDEO_FORMAT as 'mp4' | 'webm' | 'mkv',
    videoCodec: DEFAULT_VIDEO_CODEC,
    bitrateMbps: DEFAULT_VIDEO_BITRATE_MBPS,
    excludeAudio: false,
    audioCodec: DEFAULT_AUDIO_CODEC as 'aac' | 'opus',
    audioBitrateKbps: DEFAULT_AUDIO_BITRATE_KBPS,
    bitrateMode: 'variable' as 'constant' | 'variable',
    keyframeIntervalSec: DEFAULT_KEYFRAME_INTERVAL_SEC,
    width: DEFAULT_VIDEO_WIDTH,
    height: DEFAULT_VIDEO_HEIGHT,
    fps: DEFAULT_VIDEO_FPS,
    resolutionFormat: '1080p',
    orientation: 'landscape' as 'landscape' | 'portrait',
    aspectRatio: '16:9',
    isCustomResolution: false,
  });

  const audio = reactive({
    onlyFormat: DEFAULT_AUDIO_ONLY_FORMAT as 'opus' | 'aac',
    onlyCodec: DEFAULT_AUDIO_ONLY_FORMAT as 'opus' | 'aac',
    onlyBitrateKbps: DEFAULT_AUDIO_BITRATE_KBPS,
    channels: 2,
    sampleRate: 0,
    reverse: false,
    originalSampleRate: null as number | null,
    originalChannels: null as number | null,
  });

  const image = reactive({
    quality: DEFAULT_IMAGE_QUALITY,
    width: 0,
    height: 0,
    isResolutionLinked: true,
    aspectRatio: 1,
  });

  return {
    video,
    audio,
    image,
  };
}
