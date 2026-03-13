import * as Tone from 'tone';
import type { AudioClipEffect } from '~/timeline/types';

export interface ApplyAudioEffectsParams {
  buffer: AudioBuffer;
  effects: AudioClipEffect[];
}

/**
 * Applies enabled audio effects to an AudioBuffer using Tone.js offline rendering.
 * Returns a new AudioBuffer with effects applied, or the original if no effects apply.
 */
export async function applyAudioEffects({
  buffer,
  effects,
}: ApplyAudioEffectsParams): Promise<AudioBuffer> {
  const enabledEffects = effects.filter((e) => e.enabled && e.target === 'audio');
  if (enabledEffects.length === 0) return buffer;

  const duration = buffer.duration;
  if (duration <= 0) return buffer;

  const rendered = await Tone.Offline(
    async () => {
      const toneBuffer = new Tone.ToneAudioBuffer(buffer);
      const player = new Tone.Player(toneBuffer);

      const nodes: Tone.ToneAudioNode[] = [];
      const readyPromises: Promise<unknown>[] = [];

      for (const effect of enabledEffects) {
        const result = buildEffectNode(effect);
        if (!result) continue;
        nodes.push(result.node);
        if (result.ready) readyPromises.push(result.ready);
      }

      await Promise.all(readyPromises);

      if (nodes.length === 0) {
        player.toDestination();
      } else {
        player.chain(...nodes, Tone.getDestination());
      }

      player.start(0);
    },
    duration,
    buffer.numberOfChannels,
    buffer.sampleRate,
  );

  return rendered.get()!;
}

interface EffectNodeResult {
  node: Tone.ToneAudioNode;
  ready?: Promise<unknown>;
}

function buildEffectNode(effect: AudioClipEffect): EffectNodeResult | null {
  const type = effect.type;

  if (type === 'audio-reverb') {
    const reverb = new Tone.Reverb({
      decay: typeof effect.decay === 'number' ? effect.decay : 2.5,
      preDelay: typeof effect.preDelay === 'number' ? effect.preDelay : 0.01,
      wet: typeof effect.wet === 'number' ? effect.wet : 0.5,
    });
    return { node: reverb, ready: reverb.ready };
  }

  if (type === 'audio-distortion') {
    const oversample = ['none', '2x', '4x'].includes(String(effect.oversample))
      ? (effect.oversample as OverSampleType)
      : '2x';
    const distortion = new Tone.Distortion({
      distortion: typeof effect.distortion === 'number' ? effect.distortion : 0.4,
      oversample,
      wet: typeof effect.wet === 'number' ? effect.wet : 1,
    });
    return { node: distortion };
  }

  return null;
}
