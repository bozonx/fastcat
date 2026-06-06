const MKV_VIDEO_CODECS = ['avc1.640032', 'vp09.00.10.08', 'av01.0.05M.08'] as const;

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
    const alphaCodecs = ['vp09.00.10.08', 'av01.0.05M.08'];
    return alphaCodecs.includes(videoCodec ?? '');
  }
  return false;
}
