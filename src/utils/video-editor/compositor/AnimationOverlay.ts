import type { ClipTransform } from '~/timeline/types';
import {
  hasAnyAnimation,
  resolveClipAnimationTimeUs,
  sampleClipAnimations,
} from '~/timeline/animation/evaluate';
import type { CompositorClip } from './types';

/**
 * Per-frame keyframe overlay for the web compositor.
 *
 * Keyframe times are source-relative. The timeline playhead is mapped through
 * the clip's trim/speed before sampling; evaluated values are written to the
 * clip's `animatedTransform` / `animatedOpacity` overlay fields, which
 * `LayoutApplier` and `computeTransitionOpacity` prefer over static values.
 * Both are cleared when the clip has no keyframes so stale overlay never lingers.
 */

/** The clip transform to use for layout, honoring the animation overlay. */
export function effectiveClipTransform(clip: CompositorClip): ClipTransform | undefined {
  if (clip.animatedTransform) {
    return clip.animatedTransform;
  }
  return clip.transformActive !== false ? clip.transform : undefined;
}

/**
 * Merge sampled scalar params onto the clip's static transform, producing the
 * transform to render this frame. Only position/scale/rotation are animatable
 * in v1; anchor/crop/flip are carried over from the static transform.
 */
function buildAnimatedTransform(
  base: ClipTransform | undefined,
  sampled: Partial<Record<import('~/timeline/types').AnimatableParamPath, number>>,
): ClipTransform {
  const next: ClipTransform = { ...(base ?? {}) };

  const px = sampled['transform.position.x'];
  const py = sampled['transform.position.y'];
  if (px !== undefined || py !== undefined) {
    next.position = {
      x: px ?? base?.position?.x ?? 0,
      y: py ?? base?.position?.y ?? 0,
    };
  }

  const sx = sampled['transform.scale.x'];
  const sy = sampled['transform.scale.y'];
  if (sx !== undefined || sy !== undefined) {
    next.scale = {
      x: sx ?? base?.scale?.x ?? 1,
      y: sy ?? base?.scale?.y ?? 1,
      linked: base?.scale?.linked,
    };
  }

  const rot = sampled['transform.rotationDeg'];
  if (rot !== undefined) {
    next.rotationDeg = rot;
  }

  return next;
}

/**
 * Recompute a clip's animation overlay for the given timeline time. Cheap no-op
 * for clips without keyframes. Does not touch layout — callers re-apply layout
 * for the kinds that don't already re-layout per frame.
 */
export function resolveClipAnimationOverlay(clip: CompositorClip, timeUs: number): void {
  if (!hasAnyAnimation(clip.animations)) {
    clip.animatedTransform = undefined;
    clip.animatedOpacity = undefined;
    return;
  }

  const animationTimeUs = resolveClipAnimationTimeUs({
    timelineTimeUs: timeUs,
    timelineStartUs: clip.startUs,
    sourceStartUs: clip.sourceStartUs,
    sourceRangeDurationUs: clip.sourceRangeDurationUs,
    speed: clip.speed,
  });
  const sampled = sampleClipAnimations(clip.animations, animationTimeUs);

  clip.animatedOpacity = sampled.opacity;

  const hasTransformKey =
    sampled['transform.position.x'] !== undefined ||
    sampled['transform.position.y'] !== undefined ||
    sampled['transform.scale.x'] !== undefined ||
    sampled['transform.scale.y'] !== undefined ||
    sampled['transform.rotationDeg'] !== undefined;

  clip.animatedTransform = hasTransformKey
    ? buildAnimatedTransform(clip.transform, sampled)
    : undefined;
}
