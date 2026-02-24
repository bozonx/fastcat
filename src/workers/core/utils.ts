export function normalizeRpcError(errData: any): Error {
  if (!errData) return new Error('Worker RPC error');
  if (typeof errData === 'string') return new Error(errData);
  const message = typeof errData?.message === 'string' ? errData.message : 'Worker RPC error';
  const err = new Error(message);
  if (typeof errData?.name === 'string') (err as any).name = errData.name;
  if (typeof errData?.stack === 'string') (err as any).stack = errData.stack;
  return err;
}

export function getBunnyVideoCodec(codec: string): any {
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

export function getBunnyAudioCodec(codec: string | undefined): any {
  if (!codec) return 'aac';
  const v = String(codec).toLowerCase();
  if (v === 'aac' || v.startsWith('mp4a')) return 'aac';
  if (v === 'opus') return 'opus';
  return codec;
}

export function clampFloat32(v: number) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}
