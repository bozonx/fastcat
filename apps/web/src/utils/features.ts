export interface FastCatRuntimeFeatureConfig {
  public?: Record<string, unknown>;
}

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
