/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioGraphBuilder } from '~/utils/video-editor/AudioGraphBuilder';

class MockAudioNode {
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
}

class MockPannerNode extends MockAudioNode {
  pan = { value: 0 };
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 0;
}

function createMockContext(): AudioContext {
  return {
    currentTime: 0,
    createGain: vi.fn(() => new MockGainNode()),
    createAnalyser: vi.fn(() => new MockAnalyserNode()),
    createStereoPanner: vi.fn(() => new MockPannerNode()),
  } as unknown as AudioContext;
}

vi.mock('~/utils/audio/effect-graph', () => ({
  buildAudioEffectGraph: vi.fn(async () => ({
    outputNode: new MockGainNode(),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('AudioGraphBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disconnects panner node on destroy', async () => {
    const ctx = createMockContext();
    const builder = new AudioGraphBuilder();
    const source = new MockGainNode();
    const clipGain = new MockGainNode();
    const masterGain = new MockGainNode();

    const result = await builder.buildClipGraph({
      audioContext: ctx,
      sourceNode: source,
      audioBalance: 0.5,
      effects: [],
      clipGain,
      masterGain,
      trackId: 'track-1',
      analyserNodes: new Map(),
    });

    await result.destroy();

    // The panner should have been created and disconnected on destroy
    expect(ctx.createStereoPanner).toHaveBeenCalledTimes(1);
    const panner = vi.mocked(ctx.createStereoPanner).mock.results[0]?.value as MockPannerNode;
    expect(panner.disconnect).toHaveBeenCalled();
  });

  it('creates and registers track analyser', async () => {
    const ctx = createMockContext();
    const builder = new AudioGraphBuilder();
    const source = new MockGainNode();
    const clipGain = new MockGainNode();
    const masterGain = new MockGainNode();
    const analyserNodes = new Map<string, AnalyserNode>();

    await builder.buildClipGraph({
      audioContext: ctx,
      sourceNode: source,
      audioBalance: 0,
      effects: [],
      clipGain,
      masterGain,
      trackId: 'track-2',
      analyserNodes,
    });

    expect(analyserNodes.has('track-2')).toBe(true);
    expect(ctx.createAnalyser).toHaveBeenCalledTimes(1);
  });

  it('reuses existing track analyser', async () => {
    const ctx = createMockContext();
    const builder = new AudioGraphBuilder();
    const source = new MockGainNode();
    const clipGain = new MockGainNode();
    const masterGain = new MockGainNode();
    const existingAnalyser = new MockAnalyserNode();
    const analyserNodes = new Map<string, AnalyserNode>([['track-3', existingAnalyser as any]]);

    await builder.buildClipGraph({
      audioContext: ctx,
      sourceNode: source,
      audioBalance: 0,
      effects: [],
      clipGain,
      masterGain,
      trackId: 'track-3',
      analyserNodes,
    });

    // Should not create a new analyser since one already exists
    expect(ctx.createAnalyser).not.toHaveBeenCalled();
  });
});
