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
    return {
      videoCodec: 'av01.0.05M.08',
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
    videoCodec: selectedVideoCodec,
    audioCodec,
  };
}
