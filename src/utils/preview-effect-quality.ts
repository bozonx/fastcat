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
}

// Geometric render scale for the preview. Deliberately independent of play/pause and of the
// effect-quality settle window: the native monitor drops & re-decodes every video runtime
// whenever `preview_scale` changes (monitor/runtime.rs), so any dynamic scale flip black-frames
// the preview and stalls playback start. The scale is therefore a pure function of the user's
// "Preview Resolution" choice (`manualScale` > 0) or the Auto quality tier. There is no
// "still frame ⇒ full res" bump — choose "1/1" in the menu for a crisp paused frame.
export function resolvePreviewRenderScale(params: ResolvePreviewRenderScaleParams): number {
  if (params.isExport) return 1;
  const manual = Number(params.manualScale);
  if (Number.isFinite(manual) && manual > 0) return Math.min(1, manual);
  return previewEffectQualityRenderScale(params.quality);
}
