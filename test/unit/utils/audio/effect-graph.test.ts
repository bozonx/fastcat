/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { buildAudioEffectGraph } from '~/utils/audio/effect-graph';

class MockAudioNode {
  gain = { value: 1 };
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockGainNode extends MockAudioNode {}

function createMockContext(): BaseAudioContext {
  return {
    sampleRate: 48000,
    currentTime: 0,
    createGain: vi.fn(() => new MockGainNode()),
    createBiquadFilter: vi.fn(() => new MockAudioNode()),
    createConvolver: vi.fn(() => new MockAudioNode()),
  } as unknown as BaseAudioContext;
}

vi.mock('~/effects/core/registry', () => ({
  getAudioEffectManifest: vi.fn((type: string) => {
    if (type === 'audio-simple') {
      return {
        createNode: () => new MockAudioNode(),
        updateNode: vi.fn(),
      };
    }
    if (type === 'audio-graph') {
      return {
        createNode: () => ({ input: new MockAudioNode(), output: new MockAudioNode() }),
        updateNode: vi.fn(),
      };
    }
    if (type === 'audio-no-destroy') {
      return {
        createNode: () => ({ input: new MockAudioNode(), output: new MockAudioNode() }),
        updateNode: vi.fn(),
      };
    }
    if (type === 'audio-disable-wet') {
      return {
        disableGlobalWet: true,
        createNode: () => new MockAudioNode(),
        updateNode: vi.fn(),
      };
    }
    return null;
  }),
  isAudioEffectNodeGraph: vi.fn((node: unknown) => {
    return node && typeof (node as any).input === 'object' && typeof (node as any).output === 'object';
  }),
}));

describe('buildAudioEffectGraph', () => {
  it('passes source through when no effects', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = buildAudioEffectGraph({ audioContext: ctx, sourceNode: source, effects: [] });
    expect(result.outputNode).toBe(source);
  });

  it('skips disabled or non-audio effects', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [
        { id: '1', type: 'audio-simple', enabled: false, target: 'audio' },
        { id: '2', type: 'video-blur', enabled: true, target: 'video' },
      ],
    });
    expect(result.outputNode).toBe(source);
  });

  it('creates wet/dry crossfade for normal effects', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet: 0.5 }],
    });
    expect(ctx.createGain).toHaveBeenCalledTimes(3);
    expect(result.outputNode).toBeInstanceOf(MockGainNode);
  });

  it('bypasses wet/dry for disableGlobalWet effects', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-disable-wet', enabled: true, target: 'audio' }],
    });
    expect(ctx.createGain).not.toHaveBeenCalled();
    expect(result.outputNode).toBeInstanceOf(MockAudioNode);
  });

  it('calls destroyNode when present', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const destroyNode = vi.fn();
    const { getAudioEffectManifest } = vi.imported('~/effects/core/registry');
    vi.mocked(getAudioEffectManifest).mockImplementationOnce(() => ({
      createNode: () => new MockAudioNode(),
      updateNode: vi.fn(),
      destroyNode,
    }));

    const result = buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-destroyable', enabled: true, target: 'audio' }],
    });
    result.destroy();
    expect(destroyNode).toHaveBeenCalled();
  });

  it('falls back to disconnect for NodeGraph without destroyNode', () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const inputNode = new MockAudioNode();
    const outputNode = new MockAudioNode();
    const { getAudioEffectManifest } = vi.imported('~/effects/core/registry');
    vi.mocked(getAudioEffectManifest).mockImplementationOnce(() => ({
      createNode: () => ({ input: inputNode, output: outputNode }),
      updateNode: vi.fn(),
    }));

    const result = buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-no-destroy', enabled: true, target: 'audio' }],
    });
    result.destroy();
    expect(inputNode.disconnect).toHaveBeenCalled();
    expect(outputNode.disconnect).toHaveBeenCalled();
  });
});
