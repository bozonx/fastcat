export type PreviewEffectQuality = 'low' | 'medium' | 'high' | 'ultra';
export type PreviewEffectQualitySetting = PreviewEffectQuality | 'auto';

export interface ResolvePreviewEffectQualityParams {
  setting?: PreviewEffectQualitySetting;
  isExport?: boolean;
  isPlaying?: boolean;
  isMobile?: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

const QUALITY_TAP_BUDGETS: Record<PreviewEffectQuality, number> = {
  low: 8,
  medium: 16,
  high: 32,
  ultra: 48,
};

export function resolvePreviewEffectQuality(
  params: ResolvePreviewEffectQualityParams,
): PreviewEffectQuality {
  if (params.isExport) return 'ultra';
  if (params.setting && params.setting !== 'auto') return params.setting;
  if (params.isPlaying === false) return 'ultra';
  if (params.isMobile) return 'low';

  const width = Math.max(1, Number(params.width) || 1920);
  const height = Math.max(1, Number(params.height) || 1080);
  const fps = Math.max(1, Number(params.fps) || 30);
  const megapixelsPerSecond = (width * height * fps) / 1_000_000;

  if (megapixelsPerSecond >= 110) return 'low';
  if (megapixelsPerSecond >= 45) return 'medium';
  return 'high';
}

export function previewEffectQualityTapBudget(quality: PreviewEffectQuality): number {
  return QUALITY_TAP_BUDGETS[quality];
}
