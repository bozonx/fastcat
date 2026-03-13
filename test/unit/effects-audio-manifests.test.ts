import { beforeAll, describe, expect, it } from 'vitest';
import { getAllAudioEffectManifests, getAudioEffectManifest, initEffects } from '../../src/effects';

beforeAll(() => {
  initEffects();
});

describe('audio effect manifests', () => {
  it('registers audio reverb and distortion manifests', () => {
    const manifests = getAllAudioEffectManifests();
    const types = manifests.map((manifest: { type: string }) => manifest.type);

    expect(types).toContain('audio-reverb');
    expect(types).toContain('audio-distortion');
  });

  it('exposes default values for audio reverb and distortion', () => {
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
