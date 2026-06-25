import { createDevLogger } from '~/utils/dev-logger';
import { getAudioEffectManifest, isAudioEffectNodeGraph } from '~/effects/core/registry';
const log = createDevLogger('effect-graph');

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
  destroy: () => Promise<void>;
}

export async function buildAudioEffectGraph<TContext extends BaseAudioContext>({
  audioContext,
  sourceNode,
  effects,
}: BuildAudioEffectGraphParams<TContext>): Promise<BuildAudioEffectGraphResult> {
  let currentNode = sourceNode;
  const cleanups: Array<() => Promise<void>> = [];

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
    };
    const effectNode = await manifest.createNode(effectContext);

    if (manifest.updateNode) {
      await manifest.updateNode(effectNode, effect, effectContext);
    }

    const effectInput = isAudioEffectNodeGraph(effectNode) ? effectNode.input : effectNode;
    const effectOutput = isAudioEffectNodeGraph(effectNode) ? effectNode.output : effectNode;

    // Some effects (like EQ) handle wet/dry internally or don't support partial wet well
    if (manifest.disableGlobalWet) {
      currentNode.connect(effectInput);
      currentNode = effectOutput;
      cleanups.push(async () => {
        if (manifest.destroyNode) {
          try {
            await manifest.destroyNode(effectNode, effectContext);
          } catch (err) {
            log.warn(`[buildAudioEffectGraph] Failed to destroy effect node: ${effect.type}`, err);
          }
        }
        if (isAudioEffectNodeGraph(effectNode)) {
          try {
            effectNode.input.disconnect();
          } catch {
            /* no-op */
          }
          try {
            effectNode.output.disconnect();
          } catch {
            /* no-op */
          }
        } else {
          try {
            (effectNode as AudioNode).disconnect();
          } catch {
            /* no-op */
          }
        }
      });
      continue;
    }

    const wet = normalizeWet(effect.wet);
    // Linear wet/dry mix: dry + wet = 1 at all positions, ensuring constant
    // amplitude. Equal-power (cos/sin) gave a +3 dB bump at the midpoint.
    const dryGain = 1 - wet;
    const wetGain = wet;

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

    cleanups.push(async () => {
      if (manifest.destroyNode) {
        try {
          await manifest.destroyNode(effectNode, effectContext);
        } catch (err) {
          log.warn(`[buildAudioEffectGraph] Failed to destroy effect node: ${effect.type}`, err);
        }
      }

      if (isAudioEffectNodeGraph(effectNode)) {
        try {
          effectNode.input.disconnect();
        } catch {
          /* no-op */
        }
        try {
          effectNode.output.disconnect();
        } catch {
          /* no-op */
        }
      } else {
        try {
          (effectNode as AudioNode).disconnect();
        } catch {
          /* no-op */
        }
      }

      try {
        dryGainNode.disconnect();
      } catch {
        /* no-op */
      }
      try {
        wetGainNode.disconnect();
      } catch {
        /* no-op */
      }
      try {
        outputGainNode.disconnect();
      } catch {
        /* no-op */
      }
    });
  }

  return {
    outputNode: currentNode,
    destroy: async () => {
      for (const cleanup of cleanups) {
        await cleanup();
      }
    },
  };
}
