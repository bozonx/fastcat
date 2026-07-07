import { onBeforeUnmount, watch, type Ref } from 'vue';
import { clampGain } from '~/utils/audio/clamp';

interface MediaElementGainOptions {
  maxGain?: number;
}

interface MediaElementGainState {
  audioContext: AudioContext;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
  element: HTMLVideoElement | HTMLAudioElement;
  onPlay: () => void;
}

function setNativeMediaVolume(
  element: HTMLVideoElement | HTMLAudioElement,
  volume: number,
  isMuted: boolean,
) {
  element.volume = Math.min(1, Math.max(0, volume));
  element.muted = isMuted;
}

function setGainVolume(
  state: MediaElementGainState,
  element: HTMLVideoElement | HTMLAudioElement,
  volume: number,
  isMuted: boolean,
) {
  element.volume = 1;
  element.muted = false;
  state.gainNode.gain.value = isMuted ? 0 : volume;
}

export function useMediaElementGain(
  mediaElement: Ref<HTMLVideoElement | HTMLAudioElement | null>,
  volume: Ref<number>,
  isMuted: Ref<boolean>,
  options: MediaElementGainOptions = {},
) {
  let state: MediaElementGainState | null = null;
  let fallbackToNativeVolume = false;

  const maxGain = options.maxGain ?? 10;

  function cleanup() {
    if (!state) return;

    try {
      state.sourceNode.disconnect();
      state.gainNode.disconnect();
      state.element.removeEventListener('play', state.onPlay);
    } catch {
      /* no-op */
    }

    void state.audioContext.close().catch(() => {});
    state = null;
  }

  function ensureGraph(element: HTMLVideoElement | HTMLAudioElement): MediaElementGainState | null {
    if (state) return state;
    if (fallbackToNativeVolume || typeof window === 'undefined') return null;

    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return null;

    try {
      const audioContext = new AudioContextCtor();
      const sourceNode = audioContext.createMediaElementSource(element);
      const gainNode = audioContext.createGain();

      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      const onPlay = () => {
        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => {});
        }
      };

      state = { audioContext, sourceNode, gainNode, element, onPlay };

      element.addEventListener('play', onPlay);

      return state;
    } catch {
      cleanup();
      fallbackToNativeVolume = true;
      return null;
    }
  }

  function applyVolume() {
    const element = mediaElement.value;
    if (!element) return;

    const nextVolume = Math.min(maxGain, clampGain(volume.value));
    const graph = ensureGraph(element);

    if (!graph) {
      setNativeMediaVolume(element, nextVolume, isMuted.value);
      return;
    }

    setGainVolume(graph, element, nextVolume, isMuted.value);
  }

  watch(mediaElement, (nextElement, previousElement) => {
    if (nextElement !== previousElement) {
      cleanup();
      fallbackToNativeVolume = false;
    }
    applyVolume();
  });

  watch([volume, isMuted], applyVolume, { immediate: true });

  onBeforeUnmount(cleanup);

  return {
    applyVolume,
  };
}
