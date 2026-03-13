import { beforeAll, describe, expect, it } from 'vitest';
import { getAllAudioEffectManifests, getAudioEffectManifest, initEffects } from '../../src/effects';

beforeAll(() => {
  initEffects();
});

describe('audio effect manifests', () => {
  it('registers native audio effect manifests', () => {
    const manifests = getAllAudioEffectManifests();
    const types = manifests.map((manifest: { type: string }) => manifest.type);

    expect(types).toContain('audio-compressor');
    expect(types).toContain('audio-echo');
    expect(types).toContain('audio-limiter');
    expect(types).toContain('audio-tremolo');
    expect(types).toContain('audio-flanger');
    expect(types).toContain('audio-phaser');
    expect(types).toContain('audio-reverb');
    expect(types).toContain('audio-distortion');
  });

  it('exposes default values for native audio effects', () => {
    expect(getAudioEffectManifest('audio-compressor')?.defaultValues).toEqual({
      wet: 1,
      threshold: -24,
      knee: 30,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
    });

    expect(getAudioEffectManifest('audio-echo')?.defaultValues).toEqual({
      wet: 0.35,
      delayTime: 0.25,
      feedback: 0.35,
      tone: 6000,
    });

    expect(getAudioEffectManifest('audio-limiter')?.defaultValues).toEqual({
      wet: 1,
      threshold: -1,
      knee: 0,
      release: 0.1,
      makeupGain: 1,
    });

    expect(getAudioEffectManifest('audio-tremolo')?.defaultValues).toEqual({
      wet: 1,
      rate: 5,
      depth: 0.6,
    });

    expect(getAudioEffectManifest('audio-flanger')?.defaultValues).toEqual({
      wet: 0.5,
      rate: 0.25,
      depth: 0.002,
      delayTime: 0.003,
      feedback: 0.35,
    });

    expect(getAudioEffectManifest('audio-phaser')?.defaultValues).toEqual({
      wet: 0.5,
      rate: 0.3,
      depth: 800,
      feedback: 0.25,
      baseFrequency: 700,
    });

    expect(getAudioEffectManifest('audio-reverb')?.defaultValues).toEqual({
      wet: 0.5,
      decay: 2.5,
      preDelay: 0.01,
    });

    expect(getAudioEffectManifest('audio-distortion')?.defaultValues).toEqual({
      wet: 1,
      distortion: 0.4,
      oversample: '2x',
    });
  });
});
