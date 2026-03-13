import type { AudioEffectManifest } from '../../core/registry';

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
    filter.frequency.value =
      typeof values.cutoff === 'number' ? Math.max(150, Math.min(1200, values.cutoff)) : 360;
    filter.Q.value =
      typeof values.resonance === 'number' ? Math.max(0.1, Math.min(12, values.resonance)) : 4;
  },
};
