const MKV_VIDEO_CODECS = ['avc1.640032', 'vp09.00.10.08', 'av01.0.05M.08'] as const;
const OPUS_SAMPLE_RATE = 48000;

export function resolveExportCodecs(
  format: 'mp4' | 'webm' | 'mkv',
  selectedVideoCodec: string,
  selectedAudioCodec: 'aac' | 'opus' | 'flac' | 'pcm' | 'mp3',
) {
  if (format === 'webm') {
    return {
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus' as const,
    };
  }

  if (format === 'mkv') {
    const mkvAllowed = MKV_VIDEO_CODECS as unknown as string[];
    const videoCodec = mkvAllowed.includes(selectedVideoCodec)
      ? selectedVideoCodec
      : 'av01.0.05M.08';
    return {
      videoCodec,
      audioCodec: selectedAudioCodec,
    };
  }

  let audioCodec = selectedAudioCodec;
  if (format === 'mp4') {
    if (audioCodec === 'flac' || audioCodec === 'pcm') {
      audioCodec = 'aac';
    }
  }

  return {
    videoCodec: 'avc1.640032',
    audioCodec,
  };
}

export function supportsExportAlpha(format: string, videoCodec?: string) {
  if (format === 'webm') return true;
  if (format === 'mkv') {
    const alphaCodecs = ['vp09.00.10.08'];
    return alphaCodecs.includes(videoCodec ?? '');
  }
  return false;
}

export function resolveAudioExportSampleRate(params: {
  format: string;
  audioCodec?: string;
  sampleRate?: number;
}): number {
  const requested = Number(params.sampleRate);
  const sampleRate = Number.isFinite(requested) ? Math.round(requested) : OPUS_SAMPLE_RATE;
  const format = params.format.toLowerCase();
  const audioCodec = String(params.audioCodec ?? '').toLowerCase();

  if (audioCodec === 'opus' || format === 'opus' || format === 'ogg' || format === 'webm') {
    return OPUS_SAMPLE_RATE;
  }

  return Math.min(192000, Math.max(8000, sampleRate));
}
