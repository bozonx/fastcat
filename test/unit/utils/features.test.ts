import { describe, expect, it } from 'vitest';
import {
  isInDevelopmentFeaturesEnabled,
  isPremiumFeaturesEnabled,
  parseFeatureEnvFlag,
} from '~/utils/features';

describe('features', () => {
  it('keeps feature groups disabled by default', () => {
    const config = { public: {} };

    expect(isInDevelopmentFeaturesEnabled(config)).toBe(false);
    expect(isPremiumFeaturesEnabled(config)).toBe(false);
  });

  it('parses explicit truthy env values', () => {
    expect(parseFeatureEnvFlag('1')).toBe(true);
    expect(parseFeatureEnvFlag('true')).toBe(true);
    expect(parseFeatureEnvFlag('yes')).toBe(true);
    expect(parseFeatureEnvFlag('on')).toBe(true);
    expect(parseFeatureEnvFlag('false')).toBe(false);
    expect(parseFeatureEnvFlag(null)).toBe(false);
    expect(parseFeatureEnvFlag(undefined)).toBe(false);
  });

  it('correctly checks in-development and premium feature flags', () => {
    const config = {
      public: {
        inDevelopmentFeaturesEnabled: true,
        premiumFeaturesEnabled: false,
      },
    };

    expect(isInDevelopmentFeaturesEnabled(config)).toBe(true);
    expect(isPremiumFeaturesEnabled(config)).toBe(false);
  });
});

