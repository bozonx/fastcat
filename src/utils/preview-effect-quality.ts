export type PreviewEffectQuality = 'low' | 'medium' | 'high' | 'ultra';
// User-selectable preview quality. `ultra` is intentionally NOT exposed here: a still/paused
// frame already resolves to ultra, and ultra during playback is just slow — so the dial only
// offers the meaningful motion tiers plus `auto`. `ultra` remains a valid *resolved*
// `PreviewEffectQuality` (export, still frames).
export type PreviewEffectQualitySetting = 'low' | 'medium' | 'high' | 'auto';

export interface ResolvePreviewEffectQualityParams {
  setting?: PreviewEffectQualitySetting;
  isExport?: boolean;
  isPlaying?: boolean;
  isMobile?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  /**
   * Has the paused/still frame stayed static long enough to deserve the full-fidelity
   * `ultra` upgrade? Defaults to `true` (settled) so non-debounced callers keep the old
   * "paused ⇒ ultra" behaviour. The native monitor passes `false` during the interactive
   * window (scrubbing / parameter drags / the moment playback stops) so those frames render
   * at the user-selected motion quality, then re-renders once at `ultra` after the settle
   * debounce. Ignored while playing (motion already uses the user quality).
   */
  idleSettled?: boolean;
}

const QUALITY_TAP_BUDGETS: Record<PreviewEffectQuality, number> = {
  low: 8,
  medium: 16,
  high: 32,
  ultra: 48,
};

export function resolvePreviewQualityOverride(
  params: Pick<
    ResolvePreviewEffectQualityParams,
    'isExport' | 'isPlaying' | 'idleSettled' | 'setting'
  >,
): PreviewEffectQuality | null {
  if (params.isExport) return 'ultra';
  // A frozen/paused frame costs nothing extra to render at full fidelity, so show the best
  // image when not actively playing/scrubbing — even if the user pinned a lower quality. The
  // manual setting governs *motion* (playback/scrubbing) only, so this must win over an
  // explicit setting below. But only once the frame has *settled*: while the user is still
  // scrubbing or dragging effect/transition params (`idleSettled === false`) we render at the
  // cheaper motion quality and let the caller upgrade to ultra on the settle debounce.
  if (params.isPlaying === false && params.idleSettled !== false) return 'ultra';
  if (params.setting && params.setting !== 'auto') return params.setting;
  return null;
}

export function resolvePreviewEffectQuality(
  params: ResolvePreviewEffectQualityParams,
): PreviewEffectQuality {
  const override = resolvePreviewQualityOverride(params);
  if (override) return override;
  if (params.isMobile) return 'low';

  const width = Math.max(1, Number(params.width) || 1920);
  const height = Math.max(1, Number(params.height) || 1080);
  const fps = Math.max(1, Number(params.fps) || 30);
  // High frame rates also shorten the CPU/GPU scheduling window, so treat the part above
  // 30 FPS as 2x pixel work. This only moves borderline 50/60-FPS previews down one tier;
  // it avoids a feedback loop and never changes geometric preview resolution.
  const effectiveFps = fps > 30 ? 30 + (fps - 30) * 2 : fps;
  const megapixelsPerSecond = (width * height * effectiveFps) / 1_000_000;

  if (megapixelsPerSecond >= 110) return 'low';
  if (megapixelsPerSecond >= 45) return 'medium';
  return 'high';
}

export function previewEffectQualityTapBudget(quality: PreviewEffectQuality): number {
  return QUALITY_TAP_BUDGETS[quality];
}

export function previewEffectQualityRenderScale(quality: PreviewEffectQuality): number {
  // Preview effect quality deliberately never lowers geometric resolution. Users can select a
  // separate preview resolution; this dial only changes sampling work inside effects.
  void quality;
  return 1;
}

export interface ResolvePreviewRenderScaleParams {
  /** Manual `previewResolution` override. A finite value > 0 pins the scale; omit or
   * pass <= 0 for full project resolution. */
  manualScale?: number;
  /** Already-resolved effect quality tier (output of `resolvePreviewEffectQuality`). */
  quality: PreviewEffectQuality;
  isExport?: boolean;
}

// Geometric render scale is independent of effect quality, play/pause, and the settle window.
// The native monitor drops & re-decodes video runtimes whenever `preview_scale` changes, so it
// must only follow the explicit Preview Resolution setting.
export function resolvePreviewRenderScale(params: ResolvePreviewRenderScaleParams): number {
  if (params.isExport) return 1;
  const manual = Number(params.manualScale);
  if (Number.isFinite(manual) && manual > 0) return Math.min(1, manual);
  void params.quality;
  return 1;
}
