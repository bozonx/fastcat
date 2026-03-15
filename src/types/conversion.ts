export interface SharedAudioSettings {
  channels: 'stereo' | 'mono';
  sampleRate: number | null;
}

export interface VideoConversionSettings {
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrateMbps: number;
  excludeAudio: boolean;
  audioCodec: 'aac' | 'opus';
  audioBitrateKbps: number;
  bitrateMode: 'constant' | 'variable';
  keyframeIntervalSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface AudioOnlyConversionSettings {
  codec: 'opus' | 'aac';
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
