import { computed, type Ref } from 'vue';
import type {
  AnimatableParamPath,
  ClipAnimations,
  FixedAnimatableParamPath,
  KeyframeEasing,
  TimelineClipItem,
} from '~/timeline/types';
import {
  effectParamPath,
  evalTrackAt,
  hasKeyframes,
  resolveClipAnimationTimeUs,
  resolveKeyframeTimelineTimeUs,
} from '~/timeline/animation/evaluate';
import {
  addKeyframeMoment,
  applyKeyframeMoment,
  clearParamAnimation,
  collectKeyframeTimes,
  extractKeyframeMoment,
  getStaticParamValue,
  hasKeyframeMomentAt,
  moveKeyframeMoment,
  removeKeyframeMoment,
  setKeyframeMomentEasing,
  upsertKeyframe,
  type KeyframeMomentClipboard,
} from '~/timeline/animation/ops';

export interface UseClipKeyframesOptions {
  clip: Ref<TimelineClipItem>;
  /** Timeline-absolute playhead time (ticks); converted to clip-local internally. */
  playheadUs: Ref<number>;
  updateAnimations: (next: ClipAnimations | undefined) => void;
  /**
   * Move the timeline playhead (absolute ticks). Wired by the caller to the
   * timeline store; enables keyframe navigation (jump to prev/next keyframe).
   * Optional — navigation is a no-op when absent.
   */
  seek?: (timelineUs: number) => void;
}

/**
 * Bridges the pure `animation/ops` helpers to the properties panel + the
 * clip's keyframe lane: resolves the playhead to clip-local time, reads the
 * clip's current `animations`, and dispatches the result via
 * `updateAnimations` (the caller wires this to `updateClipProperties`).
 */
export function useClipKeyframes(options: UseClipKeyframesOptions) {
  const localPlayheadUs = computed(() => {
    const clip = options.clip.value;
    return resolveClipAnimationTimeUs({
      timelineTimeUs: options.playheadUs.value,
      timelineStartUs: clip.timelineRange.startUs,
      sourceStartUs: clip.sourceRange.startUs,
      sourceRangeDurationUs: clip.sourceRange.durationUs,
      speed: clip.speed,
    });
  });

  function isAnimated(path: AnimatableParamPath): boolean {
    return hasKeyframes(options.clip.value.animations?.[path]);
  }

  /**
   * Toggle animation on/off for a logical group of params (e.g. both scale
   * axes together). Turning ON seeds each path with a single keyframe at the
   * static value, so enabling never causes a visible jump. Turning OFF clears
   * every path in the group.
   */
  function toggleAnimated(paths: FixedAnimatableParamPath[]) {
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

  /** Source-relative keyframe times mapped to timeline-absolute times, ascending. */
  const keyframeTimelineTimes = computed(() => {
    const clip = options.clip.value;
    return keyframeTimes.value
      .map((sourceTimeUs) =>
        resolveKeyframeTimelineTimeUs({
          timelineStartUs: clip.timelineRange.startUs,
          sourceStartUs: clip.sourceRange.startUs,
          sourceRangeDurationUs: clip.sourceRange.durationUs,
          speed: clip.speed,
          sourceTimeUs,
        }),
      )
      .sort((a, b) => a - b);
  });

  /** True when the playhead sits exactly on a keyframe of some animated param. */
  const isOnKeyframe = computed(() =>
    hasKeyframeMomentAt(options.clip.value.animations, localPlayheadUs.value),
  );

  /** Add a keyframe on every animated param at the current playhead. */
  function addKeyframeAtPlayhead() {
    options.updateAnimations(
      addKeyframeMoment(options.clip.value.animations, localPlayheadUs.value),
    );
  }

  /** Add a keyframe moment at an explicit clip-local (source-relative) time. */
  function addKeyframeAtLocal(localTUs: number) {
    options.updateAnimations(addKeyframeMoment(options.clip.value.animations, localTUs));
  }

  /**
   * Toggle a keyframe moment at the playhead: remove it if the playhead is on
   * one, otherwise add it. Mirrors the AE/Premiere diamond button.
   */
  function toggleKeyframeAtPlayhead() {
    if (isOnKeyframe.value) {
      deleteKeyframeMomentAt(localPlayheadUs.value);
    } else {
      addKeyframeAtPlayhead();
    }
  }

  function seekToTimeline(timelineUs: number) {
    const clip = options.clip.value;
    const start = clip.timelineRange.startUs;
    const end = start + clip.timelineRange.durationUs;
    options.seek?.(Math.max(start, Math.min(end, Math.round(timelineUs))));
  }

  /** Seek the playhead to the nearest keyframe strictly before it. */
  function seekPrevKeyframe() {
    const now = options.playheadUs.value;
    const prev = keyframeTimelineTimes.value.filter((t) => t < now - 1).pop();
    if (prev !== undefined) seekToTimeline(prev);
  }

  /** Seek the playhead to the nearest keyframe strictly after it. */
  function seekNextKeyframe() {
    const now = options.playheadUs.value;
    const next = keyframeTimelineTimes.value.find((t) => t > now + 1);
    if (next !== undefined) seekToTimeline(next);
  }

  /**
   * Toggle animation for an effect parameter. Turning ON seeds a keyframe at
   * the playhead with `seedValue` (the effect's current static value) so the
   * animation doesn't jump; OFF clears the track. The path is
   * `effect.<effectId>.<key>`.
   */
  function toggleEffectParam(effectId: string, key: string, seedValue: number) {
    const path = effectParamPath(effectId, key);
    const clip = options.clip.value;
    if (isAnimated(path)) {
      options.updateAnimations(clearParamAnimation(clip.animations, path));
    } else {
      options.updateAnimations(
        upsertKeyframe(clip.animations, path, localPlayheadUs.value, seedValue),
      );
    }
  }

  /** True when the given effect parameter is keyframed. */
  function isEffectParamAnimated(effectId: string, key: string): boolean {
    return isAnimated(effectParamPath(effectId, key));
  }

  /**
   * Record an effect-param edit: upsert a keyframe at the playhead when the
   * param is animated (returns `true` so the caller skips the static update),
   * otherwise `false` (caller updates the static effect value).
   */
  function recordEffectParam(effectId: string, key: string, value: number): boolean {
    return recordValue(effectParamPath(effectId, key), value);
  }

  /** The value to show for an effect param: interpolated at the playhead when animated. */
  function effectParamDisplayValue(effectId: string, key: string, staticValue: number): number {
    return currentValue(effectParamPath(effectId, key), staticValue);
  }

  /** Capture the keyframe moment at the playhead for the clipboard (or null). */
  function copyMomentAtPlayhead(): KeyframeMomentClipboard | null {
    return extractKeyframeMoment(options.clip.value.animations, localPlayheadUs.value);
  }

  /** Paste a copied keyframe moment at the current playhead. */
  function pasteMomentAtPlayhead(moment: KeyframeMomentClipboard) {
    options.updateAnimations(
      applyKeyframeMoment(options.clip.value.animations, moment, localPlayheadUs.value),
    );
  }

  function moveKeyframeMomentAt(fromTUs: number, toTUs: number) {
    options.updateAnimations(moveKeyframeMoment(options.clip.value.animations, fromTUs, toTUs));
  }

  function deleteKeyframeMomentAt(tUs: number) {
    options.updateAnimations(removeKeyframeMoment(options.clip.value.animations, tUs));
  }

  function setKeyframeMomentEasingAt(tUs: number, easing: KeyframeEasing) {
    options.updateAnimations(setKeyframeMomentEasing(options.clip.value.animations, tUs, easing));
  }

  return {
    localPlayheadUs,
    isAnimated,
    toggleAnimated,
    recordValue,
    currentValue,
    keyframeTimes,
    keyframeTimelineTimes,
    isOnKeyframe,
    addKeyframeAtPlayhead,
    addKeyframeAtLocal,
    toggleKeyframeAtPlayhead,
    seekPrevKeyframe,
    seekNextKeyframe,
    copyMomentAtPlayhead,
    pasteMomentAtPlayhead,
    toggleEffectParam,
    isEffectParamAnimated,
    recordEffectParam,
    effectParamDisplayValue,
    moveKeyframeMomentAt,
    deleteKeyframeMomentAt,
    setKeyframeMomentEasingAt,
  };
}
