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

export function buildAudioEffectGraph<TContext extends BaseAudioContext>({
  audioContext,
  sourceNode,
  effects,
}: BuildAudioEffectGraphParams<TContext>): AudioNode {
  let currentNode = sourceNode;

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

    const dryGainNode = audioContext.createGain();
    dryGainNode.gain.value = 1 - normalizeWet(effect.wet);

    const wetGainNode = audioContext.createGain();
    wetGainNode.gain.value = normalizeWet(effect.wet);

    const outputGainNode = audioContext.createGain();
    const effectInput = isAudioEffectNodeGraph(effectNode) ? effectNode.input : effectNode;
    const effectOutput = isAudioEffectNodeGraph(effectNode) ? effectNode.output : effectNode;

    currentNode.connect(dryGainNode);
    dryGainNode.connect(outputGainNode);

    currentNode.connect(effectInput);
    effectOutput.connect(wetGainNode);
    wetGainNode.connect(outputGainNode);

    currentNode = outputGainNode;
  }

  return currentNode;
}
