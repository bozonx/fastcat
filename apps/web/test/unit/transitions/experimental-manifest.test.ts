/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getAllTransitionManifests, getTransitionManifest } from '~/transitions';

describe('experimental transition flags', () => {
  const experimentalTypes = [
    'motion-blur',
    'zoom',
    'bloom',
    'blinds',
    'cube',
    'card-swap',
    'falling-card',
  ];

  it('marks the correct transitions as experimental', () => {
    for (const type of experimentalTypes) {
      const manifest = getTransitionManifest(type);
      expect(manifest, `Transition "${type}" should exist`).toBeDefined();
      expect(manifest?.experimental, `Transition "${type}" should be experimental`).toBe(true);
    }
  });

  it('does not mark non-experimental transitions as experimental', () => {
    const nonExperimentalTypes = [
      'dissolve',
      'wipe',
      'slide',
      'clock',
      'barn-door',
      'fade-to-black',
      'circle',
      'rectangle',
    ];
    for (const type of nonExperimentalTypes) {
      const manifest = getTransitionManifest(type);
      expect(manifest, `Transition "${type}" should exist`).toBeDefined();
      expect(
        manifest?.experimental ?? false,
        `Transition "${type}" should not be experimental`,
      ).toBe(false);
    }
  });

  it('slide hides motion blur related param fields', () => {
    const manifest = getTransitionManifest('slide');
    const experimentalFields = manifest?.paramFields?.filter((f) => f.experimental) ?? [];
    const experimentalKeys = experimentalFields.map((f) => f.key);
    expect(experimentalKeys).toContain('motionBlur');
    expect(experimentalKeys).toContain('motionBlurMode');
    expect(experimentalKeys).toContain('brightnessMode');
    expect(experimentalKeys).toContain('brightness');
    expect(experimentalKeys).toContain('bloomThreshold');
  });

  it('blinds hides motion blur and post blur param fields', () => {
    const manifest = getTransitionManifest('blinds');
    const experimentalFields = manifest?.paramFields?.filter((f) => f.experimental) ?? [];
    const experimentalKeys = experimentalFields.map((f) => f.key);
    expect(experimentalKeys).toContain('blur');
    expect(experimentalKeys).toContain('motionBlur');
    expect(experimentalKeys).toContain('motionBlurMode');
    expect(experimentalKeys).toContain('brightnessMode');
    expect(experimentalKeys).toContain('brightness');
    expect(experimentalKeys).toContain('bloomThreshold');
  });

  it('all experimental manifests are present in getAllTransitionManifests', () => {
    const allTypes = getAllTransitionManifests().map((m) => m.type);
    for (const type of experimentalTypes) {
      expect(
        allTypes,
        `Experimental transition "${type}" should be in the manifest list`,
      ).toContain(type);
    }
  });
});
