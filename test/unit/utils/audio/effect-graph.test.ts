/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAudioEffectGraph } from '~/utils/audio/effect-graph';
import { getAudioEffectManifest, isAudioEffectNodeGraph } from '~/effects/core/registry';

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

vi.mock('~/effects/core/registry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('~/effects/core/registry')>();
  return {
    ...mod,
    getAudioEffectManifest: vi.fn((type: string) => {
      if (type === 'audio-simple') {
        return { createNode: () => new MockAudioNode(), updateNode: vi.fn() };
      }
      if (type === 'audio-disable-wet') {
        return {
          disableGlobalWet: true,
          createNode: () => new MockAudioNode(),
          updateNode: vi.fn(),
        };
      }
      if (type === 'audio-destroyable') {
        return {
          createNode: () => new MockAudioNode(),
          updateNode: vi.fn(),
          destroyNode: vi.fn(),
        };
      }
      if (type === 'audio-no-destroy') {
        return {
          createNode: () => ({ input: new MockAudioNode(), output: new MockAudioNode() }),
          updateNode: vi.fn(),
        };
      }
      return null;
    }),
    isAudioEffectNodeGraph: vi.fn(
      (node: unknown) =>
        node && typeof (node as any).input === 'object' && typeof (node as any).output === 'object',
    ),
  };
});

describe('buildAudioEffectGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes source through when no effects', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [],
    });
    expect(result.outputNode).toBe(source);
  });

  it('skips disabled or non-audio effects', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [
        { id: '1', type: 'audio-simple', enabled: false, target: 'audio' },
        { id: '2', type: 'video-blur', enabled: true, target: 'video' },
      ],
    });
    expect(result.outputNode).toBe(source);
  });

  it('creates wet/dry crossfade for normal effects', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet: 0.5 }],
    });
    expect(ctx.createGain).toHaveBeenCalledTimes(3);
    expect(result.outputNode).toBeInstanceOf(MockGainNode);
  });

  it('uses linear wet/dry mix (no +3dB bump at midpoint)', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet: 0.5 }],
    });
    // 3 gain nodes: dry, wet, output
    const gainNodes = vi.mocked(ctx.createGain).mock.results.map((r) => r.value as MockGainNode);
    const dryGain = gainNodes[0];
    const wetGain = gainNodes[1];
    // At wet=0.5, linear mix gives dry=0.5, wet=0.5 (sum=1.0, no +3dB bump)
    expect(dryGain.gain.value).toBe(0.5);
    expect(wetGain.gain.value).toBe(0.5);
  });

  it('linear mix sums to 1 at all wet values', async () => {
    for (const wet of [0, 0.25, 0.5, 0.75, 1]) {
      const ctx = createMockContext();
      const source = new MockAudioNode();
      await buildAudioEffectGraph({
        audioContext: ctx,
        sourceNode: source,
        effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet }],
      });
      const gainNodes = vi.mocked(ctx.createGain).mock.results.map((r) => r.value as MockGainNode);
      const dryGain = gainNodes[0];
      const wetGain = gainNodes[1];
      expect(dryGain.gain.value + wetGain.gain.value).toBeCloseTo(1, 10);
    }
  });

  it('bypasses wet/dry for disableGlobalWet effects', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-disable-wet', enabled: true, target: 'audio' }],
    });
    expect(ctx.createGain).not.toHaveBeenCalled();
  });

  it('calls destroyNode when present', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-destroyable', enabled: true, target: 'audio' }],
    });
    await result.destroy();
    const manifest = vi.mocked(getAudioEffectManifest).mock.results[0]?.value;
    expect(manifest?.destroyNode).toHaveBeenCalled();
  });

  it('falls back to disconnect for NodeGraph without destroyNode', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const inputNode = new MockAudioNode();
    const outputNode = new MockAudioNode();
    vi.mocked(getAudioEffectManifest).mockImplementationOnce(() => ({
      createNode: () => ({ input: inputNode, output: outputNode }),
      updateNode: vi.fn(),
    }));
    vi.mocked(isAudioEffectNodeGraph).mockReturnValue(true);

    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-no-destroy', enabled: true, target: 'audio' }],
    });
    await result.destroy();
    expect(inputNode.disconnect).toHaveBeenCalled();
    expect(outputNode.disconnect).toHaveBeenCalled();
  });

  it('disconnects dry/wet/output gain nodes on destroy', async () => {
    vi.mocked(isAudioEffectNodeGraph).mockReturnValue(false);
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet: 0.5 }],
    });
    await result.destroy();
    // 3 gain nodes created (dry, wet, output) — all should be disconnected
    const allGainNodes = vi.mocked(ctx.createGain).mock.results.map((r) => r.value as MockGainNode);
    expect(allGainNodes).toHaveLength(3);
    for (const node of allGainNodes) {
      expect(node.disconnect).toHaveBeenCalled();
    }
  });

  it('disconnects effect node on destroy for non-NodeGraph types', async () => {
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const effectNode = new MockAudioNode();
    vi.mocked(getAudioEffectManifest).mockImplementationOnce(() => ({
      createNode: () => effectNode,
      updateNode: vi.fn(),
    }));
    vi.mocked(isAudioEffectNodeGraph).mockReturnValue(false);

    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-simple', enabled: true, target: 'audio', wet: 0.5 }],
    });
    await result.destroy();
    expect(effectNode.disconnect).toHaveBeenCalled();
  });

  it('disconnects effect node on destroy for disableGlobalWet effects', async () => {
    vi.mocked(isAudioEffectNodeGraph).mockReturnValue(false);
    const ctx = createMockContext();
    const source = new MockAudioNode();
    const effectNode = new MockAudioNode();
    vi.mocked(getAudioEffectManifest).mockImplementationOnce(() => ({
      disableGlobalWet: true,
      createNode: () => effectNode,
      updateNode: vi.fn(),
    }));
    vi.mocked(isAudioEffectNodeGraph).mockReturnValue(false);

    const result = await buildAudioEffectGraph({
      audioContext: ctx,
      sourceNode: source,
      effects: [{ id: '1', type: 'audio-disable-wet', enabled: true, target: 'audio' }],
    });
    await result.destroy();
    expect(effectNode.disconnect).toHaveBeenCalled();
  });
});
