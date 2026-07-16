import type {
  AnimatableParamPath,
  ClipAnimations,
  FixedAnimatableParamPath,
  KeyframeEasing,
  TimelineClipItem,
} from '~/timeline/types';
import { evalTrackAt, hasKeyframes, normalizeKeyframeTrack } from './evaluate';

/**
 * Pure mutation helpers for `ClipAnimations`, used by the keyframe editing UI
 * (properties-panel stopwatch toggles + the clip's keyframe lane). Every
 * function returns a new (or the same, if unchanged) `ClipAnimations` — never
 * mutates its input — so callers can hand the result straight to
 * `updateClipProperties({ animations: next })`.
 */

/**
 * Every param path on `animations` that currently has at least one keyframe.
 * Unlike {@link ANIMATABLE_PARAM_PATHS} (the fixed transform/opacity set) this
 * reads the object's own keys, so it also covers dynamic effect-param paths
 * (`effect.<id>.<key>`). Ascending-sorted for stable iteration/output.
 */
export function animatedParamPaths(animations: ClipAnimations | undefined): AnimatableParamPath[] {
  if (!animations) return [];
  return (Object.keys(animations) as AnimatableParamPath[])
    .filter((path) => hasKeyframes(animations[path]))
    .sort();
}

function isEmptyAnimations(animations: ClipAnimations): boolean {
  return animatedParamPaths(animations).length === 0;
}

/** Insert or replace the keyframe at `tTicks` on `path` (rounds to the nearest tick). */
export function upsertKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  tTicks: number,
  value: number,
  easing: KeyframeEasing = 'linear',
): ClipAnimations {
  const roundedTTicks = Math.max(0, Math.round(tTicks));
  const existing = animations?.[path]?.keyframes ?? [];
  const withoutSameTime = existing.filter((kf) => Math.round(kf.tTicks) !== roundedTTicks);
  const nextTrack = normalizeKeyframeTrack({
    keyframes: [...withoutSameTime, { tTicks: roundedTTicks, value, easing }],
  });
  return { ...animations, [path]: nextTrack };
}

/**
 * Remove the keyframe at `tTicks` on `path`. Drops the path entirely when its
 * track becomes empty, and returns `undefined` when no path has any keyframes
 * left (so the caller can clear `animations` on the clip altogether).
 */
export function removeKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  tTicks: number,
): ClipAnimations | undefined {
  const track = animations?.[path];
  if (!track) return animations;

  const roundedTTicks = Math.round(tTicks);
  const filtered = track.keyframes.filter((kf) => Math.round(kf.tTicks) !== roundedTTicks);
  if (filtered.length === track.keyframes.length) return animations;

  const next: ClipAnimations = { ...animations };
  if (filtered.length === 0) {
    Reflect.deleteProperty(next, path);
  } else {
    next[path] = normalizeKeyframeTrack({ keyframes: filtered });
  }
  return isEmptyAnimations(next) ? undefined : next;
}

/** Move the keyframe at `fromTTicks` on `path` to `toTTicks`, preserving its value/easing. */
export function moveKeyframe(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  fromTTicks: number,
  toTTicks: number,
): ClipAnimations | undefined {
  const track = animations?.[path];
  const kf = track?.keyframes.find((k) => Math.round(k.tTicks) === Math.round(fromTTicks));
  if (!kf) return animations;
  if (Math.round(fromTTicks) === Math.round(toTTicks)) return animations;

  const withoutOld = removeKeyframe(animations, path, fromTTicks);
  return upsertKeyframe(withoutOld, path, toTTicks, kf.value, kf.easing);
}

export interface UpdateKeyframeParams {
  path: AnimatableParamPath;
  fromTTicks: number;
  toTTicks: number;
  value: number;
}

/** Move and/or retarget one keyframe on a single path, preserving its easing. */
export function updateKeyframe(
  animations: ClipAnimations | undefined,
  params: UpdateKeyframeParams,
): ClipAnimations | undefined {
  const track = animations?.[params.path];
  const kf = track?.keyframes.find(
    (keyframe) => Math.round(keyframe.tTicks) === Math.round(params.fromTTicks),
  );
  if (!kf) return animations;

  const roundedFromTTicks = Math.round(params.fromTTicks);
  const roundedToTTicks = Math.max(0, Math.round(params.toTTicks));
  if (roundedFromTTicks === roundedToTTicks && kf.value === params.value) return animations;

  const withoutOld = removeKeyframe(animations, params.path, params.fromTTicks);
  return upsertKeyframe(withoutOld, params.path, params.toTTicks, params.value, kf.easing);
}

/** Update easing on one path's keyframe at `tTicks` without changing its value. */
export function setKeyframeEasing(
  animations: ClipAnimations | undefined,
  path: AnimatableParamPath,
  tTicks: number,
  easing: KeyframeEasing,
): ClipAnimations | undefined {
  const track = animations?.[path];
  const kf = track?.keyframes.find((keyframe) => Math.round(keyframe.tTicks) === Math.round(tTicks));
  if (!kf || kf.easing === easing) return animations;
  return upsertKeyframe(animations, path, tTicks, kf.value, easing);
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
  clip: Pick<TimelineClipItem, 'opacity' | 'transform' | 'audioGain' | 'audioBalance'>,
  path: FixedAnimatableParamPath,
): number {
  switch (path) {
    case 'opacity':
      return typeof clip.opacity === 'number' && Number.isFinite(clip.opacity) ? clip.opacity : 1;
    case 'audio.volume':
      return typeof clip.audioGain === 'number' && Number.isFinite(clip.audioGain)
        ? clip.audioGain
        : 1;
    case 'audio.pan':
      return typeof clip.audioBalance === 'number' && Number.isFinite(clip.audioBalance)
        ? clip.audioBalance
        : 0;
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
    case 'transform.anchor.x':
      return clip.transform?.anchor?.x ?? 0.5;
    case 'transform.anchor.y':
      return clip.transform?.anchor?.y ?? 0.5;
    case 'transform.crop.top':
      return clip.transform?.crop?.top ?? 0;
    case 'transform.crop.bottom':
      return clip.transform?.crop?.bottom ?? 0;
    case 'transform.crop.left':
      return clip.transform?.crop?.left ?? 0;
    case 'transform.crop.right':
      return clip.transform?.crop?.right ?? 0;
    case 'transform.flipHorizontal':
      return clip.transform?.flipHorizontal ? 1 : 0;
    case 'transform.flipVertical':
      return clip.transform?.flipVertical ? 1 : 0;
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
  for (const path of animatedParamPaths(animations)) {
    for (const kf of animations[path]?.keyframes ?? []) {
      times.add(Math.round(kf.tTicks));
    }
  }
  return Array.from(times).sort((a, b) => a - b);
}

/** True when at least one animated param has a keyframe exactly at `tTicks`. */
export function hasKeyframeMomentAt(animations: ClipAnimations | undefined, tTicks: number): boolean {
  const rounded = Math.round(tTicks);
  return animatedParamPaths(animations).some((path) =>
    animations?.[path]?.keyframes.some((kf) => Math.round(kf.tTicks) === rounded),
  );
}

/**
 * Insert a keyframe at `tTicks` on every currently-animated param, each taking the
 * param's interpolated value at `tTicks` so adding a keyframe never changes the
 * motion. This is the lane's "click to add" and the navigator's add action — it
 * only touches params that already animate (turning a brand-new param on is the
 * stopwatch's job). No-op when nothing is animated.
 */
export function addKeyframeMoment(
  animations: ClipAnimations | undefined,
  tTicks: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of animatedParamPaths(animations)) {
    const value = evalTrackAt(animations?.[path], tTicks);
    if (value === undefined) continue;
    next = upsertKeyframe(next, path, tTicks, value);
  }
  return next;
}

/** Move every param's keyframe at `fromTTicks` (if any) to `toTTicks`. */
export function moveKeyframeMoment(
  animations: ClipAnimations | undefined,
  fromTTicks: number,
  toTTicks: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of animatedParamPaths(animations)) {
    next = moveKeyframe(next, path, fromTTicks, toTTicks);
  }
  return next;
}

/** Remove every param's keyframe at `tTicks` (if any). */
export function removeKeyframeMoment(
  animations: ClipAnimations | undefined,
  tTicks: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of animatedParamPaths(animations)) {
    next = removeKeyframe(next, path, tTicks);
  }
  return next;
}

/** Update easing on every param's keyframe at `tTicks` without changing values. */
export function setKeyframeMomentEasing(
  animations: ClipAnimations | undefined,
  tTicks: number,
  easing: KeyframeEasing,
): ClipAnimations | undefined {
  let next = animations;
  for (const path of animatedParamPaths(animations)) {
    const track = next?.[path];
    const kf = track?.keyframes.find((keyframe) => Math.round(keyframe.tTicks) === Math.round(tTicks));
    if (!kf) continue;
    next = upsertKeyframe(next, path, tTicks, kf.value, easing);
  }
  return next;
}

// --- Keyframe-moment copy/paste -------------------------------------------
// A "moment" copy captures the value+easing of every param's keyframe at a
// single time, so it can be pasted at another time (same clip) or onto another
// clip's matching params. The payload is plain JSON (clipboard-serializable).

/** One param's keyframe within a copied moment. */
export interface KeyframeMomentEntry {
  path: AnimatableParamPath;
  value: number;
  easing: KeyframeEasing;
}

/** A copied keyframe moment: the keyframes of every animated param at one time. */
export interface KeyframeMomentClipboard {
  entries: KeyframeMomentEntry[];
}

/**
 * Capture the keyframe moment at `tTicks`: every animated param that has a
 * keyframe exactly there, as `{ path, value, easing }`. Returns `null` when no
 * param has a keyframe at that time (nothing to copy).
 */
export function extractKeyframeMoment(
  animations: ClipAnimations | undefined,
  tTicks: number,
): KeyframeMomentClipboard | null {
  const rounded = Math.round(tTicks);
  const entries: KeyframeMomentEntry[] = [];
  for (const path of animatedParamPaths(animations)) {
    const kf = animations?.[path]?.keyframes.find((k) => Math.round(k.tTicks) === rounded);
    if (kf) entries.push({ path, value: kf.value, easing: kf.easing });
  }
  return entries.length > 0 ? { entries } : null;
}

/**
 * Paste a copied moment at `tTicks`, upserting each entry's keyframe. Params that
 * weren't animated on the target start animating (a track is created) — the
 * expected behaviour when pasting a keyframe onto a fresh clip.
 */
export function applyKeyframeMoment(
  animations: ClipAnimations | undefined,
  moment: KeyframeMomentClipboard,
  tTicks: number,
): ClipAnimations | undefined {
  let next = animations;
  for (const entry of moment.entries) {
    next = upsertKeyframe(next, entry.path, tTicks, entry.value, entry.easing);
  }
  return next;
}
