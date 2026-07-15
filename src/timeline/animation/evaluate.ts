import { clamp, clampFinite } from '~/utils/math';
import type {
  AnimatableParamPath,
  ClipAnimations,
  EffectAnimatableParamPath,
  FixedAnimatableParamPath,
  Keyframe,
  KeyframeEasing,
  KeyframeTrack,
} from '~/timeline/types';

/** Prefix marking an effect-parameter keyframe path (`effect.<id>.<key>`). */
export const EFFECT_PARAM_PREFIX = 'effect.';

/** Build an effect-parameter keyframe path from an effect id + UI value key. */
export function effectParamPath(effectId: string, key: string): EffectAnimatableParamPath {
  return `${EFFECT_PARAM_PREFIX}${effectId}.${key}`;
}

/** True when `path` addresses an effect parameter (vs. transform/opacity). */
export function isEffectParamPath(path: string): path is EffectAnimatableParamPath {
  return path.startsWith(EFFECT_PARAM_PREFIX);
}

/**
 * Split an `effect.<effectId>.<key>` path into its parts. `key` keeps any
 * remaining dots (e.g. colour channels `tintColor.r`). Returns `null` for
 * non-effect paths or malformed input.
 */
export function parseEffectParamPath(path: string): { effectId: string; key: string } | null {
  if (!isEffectParamPath(path)) return null;
  const rest = path.slice(EFFECT_PARAM_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot >= rest.length - 1) return null;
  return { effectId: rest.slice(0, dot), key: rest.slice(dot + 1) };
}

/**
 * Pure keyframe evaluation core (v1: transform + opacity).
 *
 * This module is the single source of truth for how a keyframe track collapses
 * to a scalar at a given clip-local time. Both render backends (web/Pixi and
 * native/vello) evaluate keyframes independently, so this logic is mirrored by
 * the Rust side and pinned by a shared parity fixture — keep it pure and free
 * of any timeline/store dependencies.
 */

/** The closed set of animatable parameters in v1, in a stable UI order. */
export const ANIMATABLE_PARAM_PATHS: readonly AnimatableParamPath[] = [
  'opacity',
  'audio.volume',
  'audio.pan',
  'transform.position.x',
  'transform.position.y',
  'transform.scale.x',
  'transform.scale.y',
  'transform.rotationDeg',
  'transform.anchor.x',
  'transform.anchor.y',
  'transform.crop.top',
  'transform.crop.bottom',
  'transform.crop.left',
  'transform.crop.right',
  'transform.flipHorizontal',
  'transform.flipVertical',
] as const;

export const KEYFRAME_EASINGS: readonly KeyframeEasing[] = ['linear', 'ease', 'hold'] as const;

/**
 * True when `key` is a valid animatable param path: one of the fixed
 * transform/opacity paths, or a well-formed effect-parameter path
 * (`effect.<id>.<key>`). The schema/sanitizer/coerce gates use this to accept
 * effect-param tracks while rejecting arbitrary keys.
 */
export function isAnimatableParamPath(key: string): key is AnimatableParamPath {
  return (
    (ANIMATABLE_PARAM_PATHS as readonly string[]).includes(key) ||
    parseEffectParamPath(key) !== null
  );
}

export interface ResolveClipAnimationTimeUsParams {
  timelineTimeUs: number;
  timelineStartUs: number;
  sourceStartUs?: number;
  sourceRangeDurationUs?: number;
  speed?: number;
}

/**
 * Per-path hard clamp applied to every interpolated value before it reaches the
 * renderer. Mirrors the static-value expectations of each field: opacity is a
 * `[0, 1]` alpha multiplier. Scale takes the magnitude (`abs`) — reflection is a
 * separate flip flag — matching both the static transform path and the native
 * evaluator (`animation.rs`); a negative keyed scale must NOT collapse the clip
 * to zero. Position/rotation are unbounded (any finite value).
 */
const PARAM_CLAMP: Record<FixedAnimatableParamPath, { min: number; max: number; abs?: boolean }> = {
  opacity: { min: 0, max: 1 },
  'audio.volume': { min: 0, max: 10 },
  'audio.pan': { min: -1, max: 1 },
  'transform.position.x': { min: -Infinity, max: Infinity },
  'transform.position.y': { min: -Infinity, max: Infinity },
  'transform.scale.x': { min: 0, max: Infinity, abs: true },
  'transform.scale.y': { min: 0, max: Infinity, abs: true },
  'transform.rotationDeg': { min: -Infinity, max: Infinity },
  'transform.anchor.x': { min: -10, max: 10 },
  'transform.anchor.y': { min: -10, max: 10 },
  'transform.crop.top': { min: 0, max: 100 },
  'transform.crop.bottom': { min: 0, max: 100 },
  'transform.crop.left': { min: 0, max: 100 },
  'transform.crop.right': { min: 0, max: 100 },
  'transform.flipHorizontal': { min: 0, max: 1 },
  'transform.flipVertical': { min: 0, max: 1 },
};

/**
 * Clamp an interpolated value to its parameter's valid range. Effect-parameter
 * values are only kept finite here — their per-effect range clamp lives in the
 * manifest's `toEffectSpecs` (applied during bake), so this stays generic.
 */
export function clampAnimatedValue(path: AnimatableParamPath, value: number): number {
  if (isEffectParamPath(path)) {
    return clampFinite(value, 0);
  }
  const range = PARAM_CLAMP[path];
  const finite = clampFinite(value, range.min === -Infinity ? 0 : range.min);
  return clamp(range.abs ? Math.abs(finite) : finite, range.min, range.max);
}

/** Smooth ease-in-out (smoothstep) on a normalized `[0, 1]` fraction. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function applyEasing(easing: KeyframeEasing, frac: number): number {
  switch (easing) {
    case 'ease':
      return smoothstep(frac);
    case 'hold':
      // Hold is handled before interpolation (the segment stays on the left
      // keyframe's value); if reached here, treat as a step at the left edge.
      return 0;
    case 'linear':
    default:
      return frac;
  }
}

export function isKeyframeEasing(value: unknown): value is KeyframeEasing {
  return value === 'linear' || value === 'ease' || value === 'hold';
}

function normalizeAnimationSpeed(speed: unknown): number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed !== 0
    ? Math.max(-10, Math.min(10, speed))
    : 1;
}

/**
 * Convert an absolute timeline time to the source-relative time used by
 * keyframes. Unlike video sampling, this intentionally has no end-frame guard:
 * animation curves are not constrained by decoder readability.
 */
export function resolveClipAnimationTimeUs(params: ResolveClipAnimationTimeUsParams): number {
  const timelineTimeUs = Math.round(clampFinite(params.timelineTimeUs, 0));
  const timelineStartUs = Math.round(clampFinite(params.timelineStartUs, 0));
  const localTimelineUs = Math.max(0, timelineTimeUs - timelineStartUs);
  const sourceStartUs = Math.max(0, Math.round(clampFinite(params.sourceStartUs, 0)));
  const sourceRangeDurationUs = Math.max(
    0,
    Math.round(clampFinite(params.sourceRangeDurationUs, 0)),
  );
  const speed = normalizeAnimationSpeed(params.speed);
  const sourceDeltaUs = Math.round(localTimelineUs * Math.abs(speed));

  if (sourceRangeDurationUs <= 0) {
    return sourceStartUs + sourceDeltaUs;
  }

  const sourceOffsetUs =
    speed < 0
      ? Math.max(0, sourceRangeDurationUs - sourceDeltaUs)
      : Math.min(sourceRangeDurationUs, sourceDeltaUs);

  return sourceStartUs + sourceOffsetUs;
}

/**
 * Inverse of {@link resolveClipAnimationTimeUs}: given a keyframe's
 * source-relative time, return the timeline-absolute time at which the clip
 * samples that source time. Used by keyframe navigation (seeking the playhead
 * to a keyframe) and by the lane's click-to-add (mapping a clicked timeline
 * pixel back to source time). The result is unclamped to the clip's timeline
 * range; callers clamp as needed.
 */
export function resolveKeyframeTimelineTimeUs(
  params: Omit<ResolveClipAnimationTimeUsParams, 'timelineTimeUs'> & { sourceTimeUs: number },
): number {
  const timelineStartUs = Math.round(clampFinite(params.timelineStartUs, 0));
  const sourceStartUs = Math.max(0, Math.round(clampFinite(params.sourceStartUs, 0)));
  const sourceRangeDurationUs = Math.max(
    0,
    Math.round(clampFinite(params.sourceRangeDurationUs, 0)),
  );
  const speed = normalizeAnimationSpeed(params.speed);
  const absSpeed = Math.abs(speed) || 1;

  const sourceOffsetUs = clampFinite(params.sourceTimeUs, 0) - sourceStartUs;
  const sourceDeltaUs =
    speed < 0 && sourceRangeDurationUs > 0
      ? sourceRangeDurationUs - sourceOffsetUs
      : sourceOffsetUs;

  const localTimelineUs = Math.max(0, Math.round(sourceDeltaUs / absSpeed));
  return timelineStartUs + localTimelineUs;
}

/**
 * Return a keyframe track with its keyframes sorted ascending by `tUs`, times
 * clamped to `>= 0`, and duplicate times collapsed (last write wins). This is
 * the canonical shape evaluators assume; the schema and command layer route
 * every mutation through it.
 */
export function normalizeKeyframeTrack(track: KeyframeTrack): KeyframeTrack {
  const byTime = new Map<number, Keyframe>();
  for (const kf of track.keyframes) {
    const tUs = Math.max(0, Math.round(clampFinite(kf.tUs, 0)));
    byTime.set(tUs, {
      tUs,
      value: clampFinite(kf.value, 0),
      easing: isKeyframeEasing(kf.easing) ? kf.easing : 'linear',
    });
  }
  const keyframes = Array.from(byTime.values()).sort((a, b) => a.tUs - b.tUs);
  return { keyframes };
}

/** True if the track has at least one keyframe (i.e. actually drives a value). */
export function hasKeyframes(track: KeyframeTrack | undefined): track is KeyframeTrack {
  return !!track && track.keyframes.length > 0;
}

/**
 * Evaluate a keyframe track at `clipLocalUs` (canonical timeline ticks from the clip
 * start).
 *
 * Returns `undefined` for an empty track so callers fall back to the clip's
 * static value. Before the first / after the last keyframe the track holds the
 * boundary value (no extrapolation). Assumes the track is normalized.
 */
export function evalTrackAt(
  track: KeyframeTrack | undefined,
  clipLocalUs: number,
): number | undefined {
  if (!hasKeyframes(track)) {
    return undefined;
  }

  const kfs = track.keyframes;
  const t = clampFinite(clipLocalUs, 0);

  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (kfs.length === 1 || t <= first.tUs) {
    return first.value;
  }
  if (t >= last.tUs) {
    return last.value;
  }

  // Find the segment [left, right] with left.tUs <= t < right.tUs. Guaranteed to
  // exist here since first.tUs < t < last.tUs.
  let left = first;
  let right = last;
  for (let i = 1; i < kfs.length; i++) {
    const kf = kfs[i]!;
    if (kf.tUs > t) {
      left = kfs[i - 1]!;
      right = kf;
      break;
    }
  }

  if (left.easing === 'hold') {
    return left.value;
  }

  const span = right.tUs - left.tUs;
  if (span <= 0) {
    // Coincident keyframes: jump to the right value.
    return right.value;
  }

  const frac = (t - left.tUs) / span;
  const eased = applyEasing(left.easing, frac);
  return left.value + (right.value - left.value) * eased;
}

/**
 * Sample every animated parameter of a clip at `clipLocalUs`, returning a map of
 * path → clamped value for the tracks that have keyframes. Paths without an
 * animation are omitted so the render layer keeps the clip's static value.
 */
export function sampleClipAnimations(
  animations: ClipAnimations | undefined,
  clipLocalUs: number,
): Partial<Record<AnimatableParamPath, number>> {
  const out: Partial<Record<AnimatableParamPath, number>> = {};
  if (!animations) {
    return out;
  }
  for (const path of ANIMATABLE_PARAM_PATHS) {
    const value = evalTrackAt(animations[path], clipLocalUs);
    if (value !== undefined) {
      out[path] = clampAnimatedValue(path, value);
    }
  }
  return out;
}

/** True if the clip has any keyframed parameter. */
export function hasAnyAnimation(animations: ClipAnimations | undefined): boolean {
  if (!animations) {
    return false;
  }
  return ANIMATABLE_PARAM_PATHS.some((path) => hasKeyframes(animations[path]));
}
