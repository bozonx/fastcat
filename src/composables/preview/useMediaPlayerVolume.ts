import { useLocalStorage } from '@vueuse/core';

const volume = useLocalStorage('fastcat-media-player-volume', 1.0);
const isMuted = useLocalStorage('fastcat-media-player-muted', false);

export function useMediaPlayerVolume() {
  return {
    volume,
    isMuted,
  };
}
