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

// Render-resolution multiplier derived from the quality tier. The quality dial is the
// single user-facing knob: it picks the effect sample budget *and* (in auto-resolution
// mode) the preview render scale. A still frame ignores this and renders at full res
// (see `resolvePreviewRenderScale`).
const QUALITY_RENDER_SCALES: Record<PreviewEffectQuality, number> = {
  low: 0.5,
  medium: 0.67,
  high: 0.85,
  ultra: 1,
};

export function resolvePreviewEffectQuality(
  params: ResolvePreviewEffectQualityParams,
): PreviewEffectQuality {
  if (params.isExport) return 'ultra';
  // A frozen/paused frame costs nothing extra to render at full fidelity, so always show
  // the best image when not actively playing/scrubbing — even if the user pinned a lower
  // quality. The manual setting governs *motion* (playback/scrubbing) only, so this must
  // win over an explicit setting below.
  if (params.isPlaying === false) return 'ultra';
  if (params.setting && params.setting !== 'auto') return params.setting;
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

export function previewEffectQualityRenderScale(quality: PreviewEffectQuality): number {
  return QUALITY_RENDER_SCALES[quality];
}

export interface ResolvePreviewRenderScaleParams {
  /** Manual `previewResolution` override. A finite value > 0 pins the scale; omit or
   * pass <= 0 to derive the scale from the quality tier (auto-resolution mode). */
  manualScale?: number;
  /** Already-resolved effect quality tier (output of `resolvePreviewEffectQuality`). */
  quality: PreviewEffectQuality;
  isExport?: boolean;
  isPlaying?: boolean;
}

export function resolvePreviewRenderScale(params: ResolvePreviewRenderScaleParams): number {
  if (params.isExport) return 1;
  // Mirror the effect-quality rule: a still frame is always rendered at full resolution.
  if (params.isPlaying === false) return 1;
  const manual = Number(params.manualScale);
  if (Number.isFinite(manual) && manual > 0) return Math.min(1, manual);
  return previewEffectQualityRenderScale(params.quality);
}
