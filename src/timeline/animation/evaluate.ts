import { clamp, clampFinite } from '~/utils/math';
import type {
  AnimatableParamPath,
  ClipAnimations,
  Keyframe,
  KeyframeEasing,
  KeyframeTrack,
} from '~/timeline/types';

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
  'transform.position.x',
  'transform.position.y',
  'transform.scale.x',
  'transform.scale.y',
  'transform.rotationDeg',
] as const;

/**
 * Per-path hard clamp applied to every interpolated value before it reaches the
 * renderer. Mirrors the static-value expectations of each field: opacity is a
 * `[0, 1]` alpha multiplier and scale must stay non-negative (reflection is a
 * separate flip flag). Position/rotation are unbounded (any finite value).
 */
const PARAM_CLAMP: Record<AnimatableParamPath, { min: number; max: number }> = {
  opacity: { min: 0, max: 1 },
  'transform.position.x': { min: -Infinity, max: Infinity },
  'transform.position.y': { min: -Infinity, max: Infinity },
  'transform.scale.x': { min: 0, max: Infinity },
  'transform.scale.y': { min: 0, max: Infinity },
  'transform.rotationDeg': { min: -Infinity, max: Infinity },
};

/** Clamp an interpolated value to its parameter's valid range. */
export function clampAnimatedValue(path: AnimatableParamPath, value: number): number {
  const range = PARAM_CLAMP[path];
  return clamp(clampFinite(value, range.min === -Infinity ? 0 : range.min), range.min, range.max);
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
      easing: kf.easing ?? 'linear',
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
 * Evaluate a keyframe track at `clipLocalUs` (microseconds from the clip start).
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
