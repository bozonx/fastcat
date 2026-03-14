import { buildAudioEffectGraph } from '~/utils/audio/effectGraph';

import type { AudioClipEffect } from '~/timeline/types';

export interface BuildClipAudioGraphParams {
  audioContext: AudioContext;
  sourceNode: AudioBufferSourceNode;
  audioBalance: number;
  effects: AudioClipEffect[];
  clipGain: GainNode;
  masterGain: GainNode;
  trackId?: string;
  analyserNodes: Map<string, AnalyserNode>;
}

export interface BuildClipAudioGraphResult {
  destroy: () => void;
}

export class AudioGraphBuilder {
  buildClipGraph(params: BuildClipAudioGraphParams): BuildClipAudioGraphResult {
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

    let sourceOutput: AudioNode = sourceNode;
    if (typeof anyContext.createStereoPanner === 'function') {
      const panner = anyContext.createStereoPanner();
      panner.pan.value = audioBalance;
      sourceNode.connect(panner);
      sourceOutput = panner;
    }

    const { outputNode, destroy } = buildAudioEffectGraph({
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

    return { destroy };
  }
}
