/** @vitest-environment node */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { stopNodeCollection } from '~/utils/video-editor/audio-node-utils';

function createMockNode(): AudioBufferSourceNode {
  return {
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  } as unknown as AudioBufferSourceNode;
}

function createMockGain(): GainNode {
  return {
    gain: {
      value: 1,
      cancelAndHoldAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    disconnect: vi.fn(),
  } as unknown as GainNode;
}

function createMockContext(): AudioContext {
  return {
    currentTime: 100,
  } as unknown as AudioContext;
}

describe('stopNodeCollection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears collections immediately when no fadeOut', () => {
    const nodes = new Set<AudioBufferSourceNode>([createMockNode()]);
    const cleanups = new Map();
    const gains = new Map();

    stopNodeCollection(nodes, cleanups, { gains });

    expect(nodes.size).toBe(0);
    expect(cleanups.size).toBe(0);
    expect(gains.size).toBe(0);
  });

  it('defers clearing collections until after fadeOut duration', () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    const node = createMockNode();
    const gain = createMockGain();
    const nodes = new Set<AudioBufferSourceNode>([node]);
    const cleanups = new Map<AudioBufferSourceNode, () => void>();
    const gains = new Map<AudioBufferSourceNode, GainNode>();
    cleanups.set(node, vi.fn());
    gains.set(node, gain);

    stopNodeCollection(nodes, cleanups, {
      gains,
      audioContext: ctx,
      fadeOutS: 0.5,
    });

    // Collections should NOT be cleared yet — nodes still visible during fade
    expect(nodes.size).toBe(1);
    expect(cleanups.size).toBe(1);
    expect(gains.size).toBe(1);

    // Advance past the fadeOut window
    vi.advanceTimersByTime(501);

    // Now collections should be cleared
    expect(nodes.size).toBe(0);
    expect(cleanups.size).toBe(0);
    expect(gains.size).toBe(0);

    vi.useRealTimers();
  });

  it('schedules gain ramp to zero during fadeOut', () => {
    vi.useFakeTimers();
    const ctx = createMockContext();
    const node = createMockNode();
    const gain = createMockGain();
    const nodes = new Set<AudioBufferSourceNode>([node]);
    const cleanups = new Map<AudioBufferSourceNode, () => void>();
    const gains = new Map<AudioBufferSourceNode, GainNode>();
    cleanups.set(node, vi.fn());
    gains.set(node, gain);

    stopNodeCollection(nodes, cleanups, {
      gains,
      audioContext: ctx,
      fadeOutS: 0.3,
    });

    // Gain should be ramped to 0 at currentTime + fadeOutS
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 100.3);
    // Node should be stopped at the scheduled time
    expect(node.stop).toHaveBeenCalledWith(100.3);

    vi.advanceTimersByTime(301);
    vi.useRealTimers();
  });
});
