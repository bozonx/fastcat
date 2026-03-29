import { getAudioEffectManifest, isAudioEffectNodeGraph } from '~/effects/core/registry';

export interface AudioEffectGraphEffectData {
  id: string;
  type: string;
  enabled: boolean;
  target?: string;
  wet?: unknown;
  [key: string]: unknown;
}

export interface BuildAudioEffectGraphParams<TContext extends BaseAudioContext> {
  audioContext: TContext;
  sourceNode: AudioNode;
  effects: AudioEffectGraphEffectData[];
}

function normalizeWet(value: unknown): number {
  return typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 1;
}

export interface BuildAudioEffectGraphResult {
  outputNode: AudioNode;
  destroy: () => void;
}

export function buildAudioEffectGraph<TContext extends BaseAudioContext>({
  audioContext,
  sourceNode,
  effects,
}: BuildAudioEffectGraphParams<TContext>): BuildAudioEffectGraphResult {
  let currentNode = sourceNode;
  const cleanups: Array<() => void> = [];

  for (const effect of effects) {
    if (!effect.enabled || effect.target !== 'audio') {
      continue;
    }

    const manifest = getAudioEffectManifest(effect.type);
    if (!manifest?.createNode) {
      continue;
    }

    const effectContext = {
      audioContext,
      sourceNode: currentNode,
    };
    const effectNode = manifest.createNode(effectContext);

    if (manifest.updateNode) {
      manifest.updateNode(effectNode, effect, effectContext);
    }

    cleanups.push(() => {
      if (manifest.destroyNode) {
        try {
          manifest.destroyNode(effectNode, effectContext);
        } catch (err) {
          console.warn(
            `[buildAudioEffectGraph] Failed to destroy effect node: ${effect.type}`,
            err,
          );
        }
      }
    });

    const effectInput = isAudioEffectNodeGraph(effectNode) ? effectNode.input : effectNode;
    const effectOutput = isAudioEffectNodeGraph(effectNode) ? effectNode.output : effectNode;

    // Some effects (like EQ) handle wet/dry internally or don't support partial wet well
    if (manifest.disableGlobalWet) {
      currentNode.connect(effectInput);
      currentNode = effectOutput;
      continue;
    }

    const wet = normalizeWet(effect.wet);
    // Equal-power crossfade
    const dryGain = Math.cos(wet * 0.5 * Math.PI);
    const wetGain = Math.cos((1.0 - wet) * 0.5 * Math.PI);

    const dryGainNode = audioContext.createGain();
    dryGainNode.gain.value = dryGain;

    const wetGainNode = audioContext.createGain();
    wetGainNode.gain.value = wetGain;

    const outputGainNode = audioContext.createGain();

    currentNode.connect(dryGainNode);
    dryGainNode.connect(outputGainNode);

    currentNode.connect(effectInput);
    effectOutput.connect(wetGainNode);
    wetGainNode.connect(outputGainNode);

    currentNode = outputGainNode;
  }

  return {
    outputNode: currentNode,
    destroy: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}
