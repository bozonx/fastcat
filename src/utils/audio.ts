export function formatAudioChannels(channels: number | undefined): string {
  if (!channels || channels <= 0) return '-';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} tracks`;
}
