import type {
  AnimatableParamPath,
  ClipAnimations,
  KeyframeEasing,
  TimelineClipItem,
} from '~/timeline/types';
import { ANIMATABLE_PARAM_PATHS, hasKeyframes, normalizeKeyframeTrack } from './evaluate';

/**
 * Pure mutation helpers for `ClipAnimations`, used by the keyframe editing UI
 * (properties-panel stopwatch toggles + the clip's keyframe lane). Every
 * function returns a new (or the same, if unchanged) `ClipAnimations` — never
 * mutates its input — so callers can hand the result straight to
 * `updateClipProperties({ animations: next })`.
 */

function isEmptyAnimations(animations: ClipAnimations): boolean {
  return ANIMATABLE_PARAM_PATHS.every((path) => !hasKeyframes(animations[path]));
}

/** Insert or replace the keyframe at `tUs` on `path` (rounds to the nearest µs). */
export function upsertKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  tUs: number,
  value: number,
  easing: KeyframeEasing = 'linear',
): ClipAnimations {
  const roundedTUs = Math.max(0, Math.round(tUs));
  const existing = animations?.[path]?.keyframes ?? [];
  const withoutSameTime = existing.filter((kf) => Math.round(kf.tUs) !== roundedTUs);
  const nextTrack = normalizeKeyframeTrack({
    keyframes: [...withoutSameTime, { tUs: roundedTUs, value, easing }],
  });
  return { ...animations, [path]: nextTrack };
}

/**
 * Remove the keyframe at `tUs` on `path`. Drops the path entirely when its
 * track becomes empty, and returns `undefined` when no path has any keyframes
 * left (so the caller can clear `animations` on the clip altogether).
 */
export function removeKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  tUs: number,
): ClipAnimations | undefined {
  const track = animations?.[path];
  if (!track) return animations;

  const roundedTUs = Math.round(tUs);
  const filtered = track.keyframes.filter((kf) => Math.round(kf.tUs) !== roundedTUs);
  if (filtered.length === track.keyframes.length) return animations;

  const next: ClipAnimations = { ...animations };
  if (filtered.length === 0) {
    Reflect.deleteProperty(next, path);
  } else {
    next[path] = normalizeKeyframeTrack({ keyframes: filtered });
  }
  return isEmptyAnimations(next) ? undefined : next;
}

/** Move the keyframe at `fromTUs` on `path` to `toTUs`, preserving its value/easing. */
export function moveKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  fromTUs: number,
  toTUs: number,
): ClipAnimations | undefined {
  const track = animations?.[path];
  const kf = track?.keyframes.find((k) => Math.round(k.tUs) === Math.round(fromTUs));
  if (!kf) return animations;
  if (Math.round(fromTUs) === Math.round(toTUs)) return animations;

  const withoutOld = removeKeyframe(animations, path, fromTUs);
  return upsertKeyframe(withoutOld, path, toTUs, kf.value, kf.easing);
}

/** Clear every keyframe on `path`, dropping `animations` if nothing else animates. */
export function clearParamAnimation(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
): ClipAnimations | undefined {
  if (!animations?.[path]) return animations;
  const next: ClipAnimations = { ...animations };
  Reflect.deleteProperty(next, path);
  return isEmptyAnimations(next) ? undefined : next;
}

/**
 * The clip's current static value for `path` — the fallback used when a param
 * has no keyframes, and the seed value when a stopwatch is first turned on
 * (the animation should not visibly jump when enabled).
 */
export function getStaticParamValue(
  clip: Pick<TimelineClipItem, 'opacity' | 'transform'>,
  path: AnimatableParamPath,
): number {
  switch (path) {
    case 'opacity':
      return typeof clip.opacity === 'number' && Number.isFinite(clip.opacity) ? clip.opacity : 1;
    case 'transform.position.x':
      return clip.transform?.position?.x ?? 0;
    case 'transform.position.y':
      return clip.transform?.position?.y ?? 0;
    case 'transform.scale.x':
      return clip.transform?.scale?.x ?? 1;
    case 'transform.scale.y':
      return clip.transform?.scale?.y ?? 1;
    case 'transform.rotationDeg':
      return clip.transform?.rotationDeg ?? 0;
  }
}

// --- Cross-param "moment" ops, for the clip's unified keyframe lane --------
// The lane shows one diamond per unique time across ALL animated params (not
// one row per param) — dragging or deleting a diamond moves/removes the
// keyframe at that time on every param that has one there.

/** Every distinct keyframe time across all animated params, ascending. */
export function collectKeyframeTimes(animations: ClipAnimations | undefined): number[] {
  if (!animations) return [];
  const times = new Set<number>();
  for (const path of ANIMATABLE_PARAM_PATHS) {
    for (const kf of animations[path]?.keyframes ?? []) {
      times.add(Math.round(kf.tUs));
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}

/** Move every param's keyframe at `fromTUs` (if any) to `toTUs`. */
export function moveKeyframeMoment(
  animations: ClipAnimations | undefined,
  fromTUs: number,
  toTUs: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of ANIMATABLE_PARAM_PATHS) {
    next = moveKeyframe(next, path, fromTUs, toTUs);
  }
  return next;
}

/** Remove every param's keyframe at `tUs` (if any). */
export function removeKeyframeMoment(
  animations: ClipAnimations | undefined,
  tUs: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of ANIMATABLE_PARAM_PATHS) {
    next = removeKeyframe(next, path, tUs);
  }
  return next;
}
