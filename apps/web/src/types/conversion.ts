export interface SharedAudioSettings {
  channels: number;
  sampleRate: number | null;
}

export interface VideoConversionSettings {
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrateMbps: number;
  excludeAudio: boolean;
  audioCodec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3';
  audioBitrateKbps: number;
  bitrateMode: 'constant' | 'variable';
  keyframeIntervalSec: number;
  fastStart?: boolean;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface AudioOnlyConversionSettings {
  codec: 'opus' | 'aac' | 'flac' | 'pcm' | 'mp3';
  bitrateKbps: number;
  reverse: boolean;
}

export interface ImageConversionSettings {
  quality: number;
  width: number;
  height: number;
}

export interface ConversionRequest {
  entry: import('~/types/fs').FsEntry;
  type: 'video' | 'audio' | 'image';
  dirPath: string;
  newFileName: string;
  sharedAudio: SharedAudioSettings;
  video?: VideoConversionSettings;
  audioOnly?: AudioOnlyConversionSettings;
  image?: ImageConversionSettings;
}
