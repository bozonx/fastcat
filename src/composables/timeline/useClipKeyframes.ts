import { computed, type Ref } from 'vue';
import type { AnimatableParamPath, ClipAnimations, TimelineClipItem } from '~/timeline/types';
import { evalTrackAt, hasKeyframes } from '~/timeline/animation/evaluate';
import {
  clearParamAnimation,
  collectKeyframeTimes,
  getStaticParamValue,
  moveKeyframeMoment,
  removeKeyframeMoment,
  upsertKeyframe,
} from '~/timeline/animation/ops';

export interface UseClipKeyframesOptions {
  clip: Ref<TimelineClipItem>;
  /** Timeline-absolute playhead time (µs); converted to clip-local internally. */
  playheadUs: Ref<number>;
  updateAnimations: (next: ClipAnimations | undefined) => void;
}

/**
 * Bridges the pure `animation/ops` helpers to the properties panel + the
 * clip's keyframe lane: resolves the playhead to clip-local time, reads the
 * clip's current `animations`, and dispatches the result via
 * `updateAnimations` (the caller wires this to `updateClipProperties`).
 */
export function useClipKeyframes(options: UseClipKeyframesOptions) {
  const localPlayheadUs = computed(() =>
    Math.max(0, Math.round(options.playheadUs.value - options.clip.value.timelineRange.startUs)),
  );

  function isAnimated(path: AnimatableParamPath): boolean {
    return hasKeyframes(options.clip.value.animations?.[path]);
  }

  /**
   * Toggle animation on/off for a logical group of params (e.g. both scale
   * axes together). Turning ON seeds each path with a single keyframe at the
   * static value, so enabling never causes a visible jump. Turning OFF clears
   * every path in the group.
   */
  function toggleAnimated(paths: AnimatableParamPath[]) {
    const clip = options.clip.value;
    const turningOff = paths.some((path) => isAnimated(path));
    let next = clip.animations;
    if (turningOff) {
      for (const path of paths) {
        next = clearParamAnimation(next, path);
      }
    } else {
      for (const path of paths) {
        next = upsertKeyframe(next, path, localPlayheadUs.value, getStaticParamValue(clip, path));
      }
    }
    options.updateAnimations(next);
  }

  /**
   * Route a param edit through the keyframe track when it's animated, upserting
   * a keyframe at the playhead. Returns `true` when the edit was recorded as a
   * keyframe (caller should skip its normal static-value update), `false` when
   * the path isn't animated (caller should proceed as usual).
   */
  function recordValue(path: AnimatableParamPath, value: number): boolean {
    if (!isAnimated(path)) return false;
    options.updateAnimations(
      upsertKeyframe(options.clip.value.animations, path, localPlayheadUs.value, value),
    );
    return true;
  }

  /**
   * The value a param currently shows in the UI: the interpolated keyframe
   * value at the playhead when animated, otherwise `staticValue` (the clip's
   * plain field). Lets a property control display "what's playing" instead of
   * the (now largely irrelevant) static field once a param is animated.
   */
  function currentValue(path: AnimatableParamPath, staticValue: number): number {
    const track = options.clip.value.animations?.[path];
    if (!hasKeyframes(track)) return staticValue;
    return evalTrackAt(track, localPlayheadUs.value) ?? staticValue;
  }

  const keyframeTimes = computed(() => collectKeyframeTimes(options.clip.value.animations));

  function moveKeyframeMomentAt(fromTUs: number, toTUs: number) {
    options.updateAnimations(moveKeyframeMoment(options.clip.value.animations, fromTUs, toTUs));
  }

  function deleteKeyframeMomentAt(tUs: number) {
    options.updateAnimations(removeKeyframeMoment(options.clip.value.animations, tUs));
  }

  return {
    localPlayheadUs,
    isAnimated,
    toggleAnimated,
    recordValue,
    currentValue,
    keyframeTimes,
    moveKeyframeMomentAt,
    deleteKeyframeMomentAt,
  };
}
