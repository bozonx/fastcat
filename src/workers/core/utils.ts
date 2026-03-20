export function normalizeRpcError(errData: unknown): Error {
  if (!errData) return new Error('Worker RPC error');
  if (typeof errData === 'string') return new Error(errData);
  const data = errData as Record<string, unknown>;
  const message = typeof data?.message === 'string' ? data.message : 'Worker RPC error';
  const err = new Error(message);
  if (typeof data?.name === 'string') err.name = data.name;
  if (typeof data?.stack === 'string') err.stack = data.stack;
  return err;
}

export type BunnyVideoCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1';

export type BunnyAudioCodec =
  | 'opus'
  | 'vorbis'
  | 'aac'
  | 'mp3'
  | 'flac'
  | 'ac3'
  | 'eac3'
  | 'pcm-s16'
  | 'pcm-s16be'
  | 'pcm-s24'
  | 'pcm-s24be'
  | 'pcm-s32'
  | 'pcm-s32be'
  | 'pcm-f32'
  | 'pcm-f32be'
  | 'pcm-f64'
  | 'pcm-f64be'
  | 'mulaw'
  | 'alaw';

export function getBunnyVideoCodec(codec: string): BunnyVideoCodec {
  if (codec.startsWith('avc1')) return 'avc';
  if (codec.startsWith('hvc1') || codec.startsWith('hev1')) return 'hevc';
  if (codec.startsWith('vp8')) return 'vp8';
  if (codec.startsWith('vp09')) return 'vp9';
  if (codec.startsWith('av01')) return 'av1';
  return 'avc';
}

export function parseVideoCodec(codec: string): string {
  if (codec.startsWith('avc1')) return 'H.264 (AVC)';
  if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 'H.265 (HEVC)';
  if (codec.startsWith('vp09')) return 'VP9';
  if (codec.startsWith('av01')) return 'AV1';
  return codec;
}

export function parseAudioCodec(codec: string): string {
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec.startsWith('opus')) return 'Opus';
  if (codec.startsWith('vorbis')) return 'Vorbis';
  return codec;
}

export function getBunnyAudioCodec(codec: string | undefined): BunnyAudioCodec {
  if (!codec) return 'aac';
  const v = String(codec).toLowerCase();
  if (v === 'aac' || v.startsWith('mp4a')) return 'aac';
  if (v === 'opus') return 'opus';
  return v as BunnyAudioCodec;
}

export function clampFloat32(v: number) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
