import { describe, expect, it } from 'vitest';
import {
  isFastCatFeatureEnabled,
  isInDevelopmentFeaturesEnabled,
  isPremiumFeaturesEnabled,
  parseFeatureEnvFlag,
} from '~/utils/features';

describe('features', () => {
  it('keeps both feature groups disabled by default', () => {
    const config = { public: {} };

    expect(isInDevelopmentFeaturesEnabled(config)).toBe(false);
    expect(isPremiumFeaturesEnabled(config)).toBe(false);
    expect(isFastCatFeatureEnabled('conversion', config)).toBe(false);
    expect(isFastCatFeatureEnabled('hud', config)).toBe(false);
    expect(isFastCatFeatureEnabled('audioExtraction', config)).toBe(false);
  });

  it('parses explicit truthy env values', () => {
    expect(parseFeatureEnvFlag('1')).toBe(true);
    expect(parseFeatureEnvFlag('true')).toBe(true);
    expect(parseFeatureEnvFlag('yes')).toBe(true);
    expect(parseFeatureEnvFlag('on')).toBe(true);
    expect(parseFeatureEnvFlag('false')).toBe(false);
  });

  it('requires both development and premium flags for conversion', () => {
    expect(
      isFastCatFeatureEnabled('conversion', {
        public: {
          inDevelopmentFeaturesEnabled: true,
          premiumFeaturesEnabled: false,
        },
      }),
    ).toBe(false);

    expect(
      isFastCatFeatureEnabled('conversion', {
        public: {
          inDevelopmentFeaturesEnabled: true,
          premiumFeaturesEnabled: true,
        },
      }),
    ).toBe(true);
  });

  it('requires only premium flag for hud', () => {
    expect(
      isFastCatFeatureEnabled('hud', {
        public: {
          inDevelopmentFeaturesEnabled: false,
          premiumFeaturesEnabled: true,
        },
      }),
    ).toBe(true);
  });

  it('requires both development and premium flags for audioExtraction', () => {
    expect(
      isFastCatFeatureEnabled('audioExtraction', {
        public: {
          inDevelopmentFeaturesEnabled: true,
          premiumFeaturesEnabled: false,
        },
      }),
    ).toBe(false);

    expect(
      isFastCatFeatureEnabled('audioExtraction', {
        public: {
          inDevelopmentFeaturesEnabled: false,
          premiumFeaturesEnabled: true,
        },
      }),
    ).toBe(false);

    expect(
      isFastCatFeatureEnabled('audioExtraction', {
        public: {
          inDevelopmentFeaturesEnabled: true,
          premiumFeaturesEnabled: true,
        },
      }),
    ).toBe(true);
  });
});
