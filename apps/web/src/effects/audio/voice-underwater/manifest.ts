import type { AudioEffectManifest } from '../../core/registry';
import { clampAudioParam } from '../../../utils/audio/clamp';

export interface VoiceUnderwaterParams {
  wet: number;
  cutoff: number;
  resonance: number;
}

export const voiceUnderwaterManifest: AudioEffectManifest<VoiceUnderwaterParams> = {
  type: 'audio-voice-underwater',
  name: 'Underwater',
  description: 'Heavy low-pass filtering for submerged and flashback scenes',
  icon: 'i-heroicons-beaker',
  target: 'audio',
  category: 'voice',
  defaultValues: {
    wet: 1,
    cutoff: 360,
    resonance: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'wet',
      label: 'Wet',
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(Number(value) * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'cutoff',
      label: 'Cutoff',
      min: 150,
      max: 1200,
      step: 10,
      format: (value) => `${Math.round(Number(value))} Hz`,
    },
    {
      kind: 'slider',
      key: 'resonance',
      label: 'Resonance',
      min: 0.1,
      max: 12,
      step: 0.1,
      format: (value) => Number(value).toFixed(1),
    },
  ],
  createNode(context) {
    const filter = context.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    return filter;
  },
  updateNode(node, values) {
    const filter = node as BiquadFilterNode;
    filter.frequency.value = clampAudioParam(values.cutoff, 150, 1200, 360);
    filter.Q.value = clampAudioParam(values.resonance, 0.1, 12, 4);
  },
  destroyNode(node) {
    const filter = node as BiquadFilterNode;
    try {
      filter.disconnect();
    } catch {
      /* no-op */
    }
  },
};
