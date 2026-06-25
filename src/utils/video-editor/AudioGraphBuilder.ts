import { buildAudioEffectGraph } from '~/utils/audio/effect-graph';

import type { AudioClipEffect } from '~/timeline/types';

export interface BuildClipAudioGraphParams {
  audioContext: AudioContext;
  sourceNode: AudioNode;
  audioBalance: number;
  effects: AudioClipEffect[];
  clipGain: GainNode;
  masterGain: GainNode;
  trackId?: string;
  analyserNodes: Map<string, AnalyserNode>;
}

export interface BuildClipAudioGraphResult {
  destroy: () => Promise<void>;
}

export class AudioGraphBuilder {
  async buildClipGraph(params: BuildClipAudioGraphParams): Promise<BuildClipAudioGraphResult> {
    const {
      audioContext,
      sourceNode,
      audioBalance,
      effects,
      clipGain,
      masterGain,
      trackId,
      analyserNodes,
    } = params;

    const anyContext = audioContext as AudioContext & {
      createStereoPanner?: () => StereoPannerNode;
    };

    // Force the per-clip signal to stereo so a mono source uses the SAME
    // equal-power stereo pan law as the export/native mixer. A 1-channel input
    // makes StereoPannerNode switch to its mono law (centre = -3 dB/channel),
    // which left mono clips ~3 dB quieter and panned differently in preview than
    // in the rendered file. Up-mixing mono -> [mono, mono] here mirrors
    // AudioMixer.normalizeSampleChannels + getStereoPanMatrix.
    try {
      sourceNode.channelCountMode = 'explicit';
      sourceNode.channelCount = 2;
      sourceNode.channelInterpretation = 'speakers';
    } catch {
      /* some environments expose these as read-only — fall back to default routing */
    }

    let sourceOutput: AudioNode = sourceNode;
    let panner: StereoPannerNode | null = null;
    if (typeof anyContext.createStereoPanner === 'function') {
      panner = anyContext.createStereoPanner();
      panner.pan.value = audioBalance;
      sourceNode.connect(panner);
      sourceOutput = panner;
    }

    const { outputNode, destroy } = await buildAudioEffectGraph({
      audioContext,
      sourceNode: sourceOutput,
      effects,
    });

    outputNode.connect(clipGain);

    if (trackId) {
      let trackAnalyser = analyserNodes.get(trackId);
      if (!trackAnalyser) {
        trackAnalyser = audioContext.createAnalyser();
        trackAnalyser.fftSize = 2048;
        analyserNodes.set(trackId, trackAnalyser);
      }
      clipGain.connect(trackAnalyser);
      trackAnalyser.connect(masterGain);
    } else {
      clipGain.connect(masterGain);
    }

    return {
      destroy: async () => {
        await destroy();
        if (panner) {
          try {
            panner.disconnect();
          } catch {
            /* no-op */
          }
        }
      },
    };
  }
}
