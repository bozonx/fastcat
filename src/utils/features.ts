export type FastCatFeatureId = 'conversion' | 'hud' | 'audioExtraction';

export interface FastCatFeatureDefinition {
  inDevelopment: boolean;
  premium: boolean;
}

export interface FastCatRuntimeFeatureConfig {
  public?: Record<string, unknown>;
}

export const FASTCAT_FEATURES: Record<FastCatFeatureId, FastCatFeatureDefinition> = {
  conversion: {
    inDevelopment: true,
    premium: true,
  },
  hud: {
    inDevelopment: false,
    premium: true,
  },
  audioExtraction: {
    inDevelopment: true,
    premium: true,
  },
};

export function parseFeatureEnvFlag(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isInDevelopmentFeaturesEnabled(config: FastCatRuntimeFeatureConfig): boolean {
  return parseFeatureEnvFlag(config.public?.inDevelopmentFeaturesEnabled);
}

export function isPremiumFeaturesEnabled(config: FastCatRuntimeFeatureConfig): boolean {
  return parseFeatureEnvFlag(config.public?.premiumFeaturesEnabled);
}

export function isFastCatFeatureEnabled(
  featureId: FastCatFeatureId,
  config: FastCatRuntimeFeatureConfig,
): boolean {
  const feature = FASTCAT_FEATURES[featureId];
  if (feature.inDevelopment && !isInDevelopmentFeaturesEnabled(config)) return false;
  if (feature.premium && !isPremiumFeaturesEnabled(config)) return false;
  return true;
}
