import { computed, type Ref } from 'vue';
import type {
  AnimatableParamPath,
  ClipAnchorPreset,
  ClipTransform,
  TimelineClipItem,
  TrackKind,
} from '~/timeline/types';

interface UseClipTransformOptions {
  clip: Ref<TimelineClipItem>;
  trackKind?: Ref<TrackKind>;
  updateTransform: (next: ClipTransform) => void;
  /**
   * When a leaf transform param is animated, its setter routes the edit to
   * `onAnimatedParamEdit` (upserting a keyframe) instead of touching the
   * static transform. Both optional — omit to disable animation routing
   * entirely (e.g. the multi-clip transform panel, which has no keyframes).
   */
  isParamAnimated?: (path: AnimatableParamPath) => boolean;
  onAnimatedParamEdit?: (path: AnimatableParamPath, value: number) => void;
  /** When a param is animated, its getter shows this (the value at the
   * playhead) instead of the static transform field. */
  getAnimatedDisplayValue?: (path: AnimatableParamPath, staticValue: number) => number;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

function getSafeTransform(clip: TimelineClipItem): ClipTransform {
  const tr = ((clip as { transform?: ClipTransform }).transform ?? {}) as ClipTransform;
  const scaleRaw = (tr.scale ?? {}) as Record<string, unknown>;
  let scaleX = typeof scaleRaw.x === 'number' && Number.isFinite(scaleRaw.x) ? scaleRaw.x : 1;
  let scaleY = typeof scaleRaw.y === 'number' && Number.isFinite(scaleRaw.y) ? scaleRaw.y : 1;
  const linked = scaleRaw.linked !== undefined ? Boolean(scaleRaw.linked) : true;

  let flipHorizontal = tr.flipHorizontal !== undefined ? Boolean(tr.flipHorizontal) : false;
  let flipVertical = tr.flipVertical !== undefined ? Boolean(tr.flipVertical) : false;

  // Migration for old projects using negative scale values for flip
  if (scaleX < 0) {
    scaleX = Math.abs(scaleX);
    flipHorizontal = !flipHorizontal;
  }
  if (scaleY < 0) {
    scaleY = Math.abs(scaleY);
    flipVertical = !flipVertical;
  }

  const positionRaw = (tr.position ?? {}) as Record<string, unknown>;
  const posX =
    typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0;
  const posY =
    typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0;

  const rotationDeg =
    typeof tr.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;

  const anchorRaw = (tr.anchor ?? {}) as Record<string, unknown>;
  const preset =
    anchorRaw.preset === 'center' ||
    anchorRaw.preset === 'topLeft' ||
    anchorRaw.preset === 'topRight' ||
    anchorRaw.preset === 'bottomLeft' ||
    anchorRaw.preset === 'bottomRight' ||
    anchorRaw.preset === 'custom'
      ? anchorRaw.preset
      : 'center';
  const anchorX =
    typeof anchorRaw.x === 'number' && Number.isFinite(anchorRaw.x) ? anchorRaw.x : 0.5;
  const anchorY =
    typeof anchorRaw.y === 'number' && Number.isFinite(anchorRaw.y) ? anchorRaw.y : 0.5;

  const cropRaw = (tr.crop ?? {}) as Record<string, unknown>;
  const cropTop = typeof cropRaw.top === 'number' && Number.isFinite(cropRaw.top) ? cropRaw.top : 0;
  const cropBottom =
    typeof cropRaw.bottom === 'number' && Number.isFinite(cropRaw.bottom) ? cropRaw.bottom : 0;
  const cropLeft =
    typeof cropRaw.left === 'number' && Number.isFinite(cropRaw.left) ? cropRaw.left : 0;
  const cropRight =
    typeof cropRaw.right === 'number' && Number.isFinite(cropRaw.right) ? cropRaw.right : 0;

  return {
    scale: {
      x: scaleX === 0 ? 0.001 : clampNumber(scaleX, 0.001, 1000),
      y: scaleY === 0 ? 0.001 : clampNumber(scaleY, 0.001, 1000),
      linked,
    },
    position: {
      x: clampNumber(posX, -1_000_000, 1_000_000),
      y: clampNumber(posY, -1_000_000, 1_000_000),
    },
    rotationDeg: clampNumber(rotationDeg, -36000, 36000),
    anchor:
      preset === 'custom'
        ? { preset, x: clampNumber(anchorX, -10, 10), y: clampNumber(anchorY, -10, 10) }
        : { preset },
    crop: {
      top: clampNumber(cropTop, 0, 100),
      bottom: clampNumber(cropBottom, 0, 100),
      left: clampNumber(cropLeft, 0, 100),
      right: clampNumber(cropRight, 0, 100),
    },
    flipHorizontal,
    flipVertical,
  };
}

export function useClipTransform(options: UseClipTransformOptions) {
  const canEditTransform = computed(() => {
    if (options.trackKind && options.clip.value.clipType !== 'adjustment') {
      return options.trackKind.value === 'video';
    }
    return false;
  });

  const { t } = useI18n();

  const anchorPresetOptions = computed(() => [
    { value: 'center', label: t('fastcat.clip.transform.anchorPreset.center') },
    {
      value: 'topLeft',
      label: t('fastcat.clip.transform.anchorPreset.topLeft'),
    },
    {
      value: 'topRight',
      label: t('fastcat.clip.transform.anchorPreset.topRight'),
    },
    {
      value: 'bottomLeft',
      label: t('fastcat.clip.transform.anchorPreset.bottomLeft'),
    },
    {
      value: 'bottomRight',
      label: t('fastcat.clip.transform.anchorPreset.bottomRight'),
    },
    { value: 'custom', label: t('fastcat.clip.transform.anchorPreset.custom') },
  ]);

  function updateSelectedClipTransform(patch: Partial<ClipTransform>) {
    const clip = options.clip.value;
    const current = getSafeTransform(clip);
    const next: ClipTransform = {
      ...current,
      ...patch,
      scale: {
        ...(current.scale ?? { x: 1, y: 1, linked: true }),
        ...(patch.scale ?? {}),
      },
      position: {
        ...(current.position ?? { x: 0, y: 0 }),
        ...(patch.position ?? {}),
      },
      anchor: {
        ...(current.anchor ?? { preset: 'center' }),
        ...(patch.anchor ?? {}),
      },
      crop: {
        ...(current.crop ?? { top: 0, bottom: 0, left: 0, right: 0 }),
        ...(patch.crop ?? {}),
      },
      flipHorizontal:
        patch.flipHorizontal !== undefined ? patch.flipHorizontal : current.flipHorizontal,
      flipVertical: patch.flipVertical !== undefined ? patch.flipVertical : current.flipVertical,
    };

    options.updateTransform(next);
  }

  /** Routes an animated leaf param's edit to a keyframe; returns whether it did. */
  function tryRecordAnimatedEdit(path: AnimatableParamPath, value: number): boolean {
    if (!options.isParamAnimated?.(path)) return false;
    options.onAnimatedParamEdit?.(path, value);
    return true;
  }

  const transformScaleLinked = computed({
    get: () => {
      return Boolean(getSafeTransform(options.clip.value).scale?.linked);
    },
    set: (val: boolean) => {
      const current = getSafeTransform(options.clip.value);
      const linked = Boolean(val);
      const x = current.scale?.x ?? 1;
      const y = current.scale?.y ?? 1;
      updateSelectedClipTransform({
        scale: linked ? { x, y: x, linked } : { x, y, linked },
      });
    },
  });

  const transformScaleX = computed({
    get: () => {
      const staticX = getSafeTransform(options.clip.value).scale?.x ?? 1;
      const x = options.getAnimatedDisplayValue?.('transform.scale.x', staticX) ?? staticX;
      return Number((x * 100).toFixed(1));
    },
    set: (val: number) => {
      let x = val / 100;
      x = x === 0 ? 0.001 : clampNumber(x, 0.001, 1000);
      if (tryRecordAnimatedEdit('transform.scale.x', x)) return;
      const current = getSafeTransform(options.clip.value);
      const linked = Boolean(current.scale?.linked);
      const y = linked ? Math.sign(current.scale?.y ?? 1) * Math.abs(x) : (current.scale?.y ?? 1);
      updateSelectedClipTransform({ scale: { x, y, linked } });
    },
  });

  const transformScaleY = computed({
    get: () => {
      const staticY = getSafeTransform(options.clip.value).scale?.y ?? 1;
      const y = options.getAnimatedDisplayValue?.('transform.scale.y', staticY) ?? staticY;
      return Number((y * 100).toFixed(1));
    },
    set: (val: number) => {
      let y = val / 100;
      y = y === 0 ? 0.001 : clampNumber(y, 0.001, 1000);
      if (tryRecordAnimatedEdit('transform.scale.y', y)) return;
      const current = getSafeTransform(options.clip.value);
      const linked = Boolean(current.scale?.linked);
      const x = linked ? Math.sign(current.scale?.x ?? 1) * Math.abs(y) : (current.scale?.x ?? 1);
      updateSelectedClipTransform({ scale: { x, y, linked } });
    },
  });

  const transformRotationDeg = computed({
    get: () => {
      const staticDeg = getSafeTransform(options.clip.value).rotationDeg ?? 0;
      return options.getAnimatedDisplayValue?.('transform.rotationDeg', staticDeg) ?? staticDeg;
    },
    set: (val: number) => {
      const deg = clampNumber(val, -36000, 36000);
      if (tryRecordAnimatedEdit('transform.rotationDeg', deg)) return;
      updateSelectedClipTransform({ rotationDeg: deg });
    },
  });

  const transformPosX = computed({
    get: () => {
      const staticX = getSafeTransform(options.clip.value).position?.x ?? 0;
      return options.getAnimatedDisplayValue?.('transform.position.x', staticX) ?? staticX;
    },
    set: (val: number) => {
      const x = clampNumber(val, -1_000_000, 1_000_000);
      if (tryRecordAnimatedEdit('transform.position.x', x)) return;
      const current = getSafeTransform(options.clip.value);
      updateSelectedClipTransform({
        position: { x, y: current.position?.y ?? 0 },
      });
    },
  });

  const transformPosY = computed({
    get: () => {
      const staticY = getSafeTransform(options.clip.value).position?.y ?? 0;
      return options.getAnimatedDisplayValue?.('transform.position.y', staticY) ?? staticY;
    },
    set: (val: number) => {
      const y = clampNumber(val, -1_000_000, 1_000_000);
      if (tryRecordAnimatedEdit('transform.position.y', y)) return;
      const current = getSafeTransform(options.clip.value);
      updateSelectedClipTransform({
        position: { x: current.position?.x ?? 0, y },
      });
    },
  });

  const transformAnchorPreset = computed({
    get: () => {
      return getSafeTransform(options.clip.value).anchor?.preset ?? 'center';
    },
    set: (val: unknown) => {
      const preset =
        typeof val === 'string'
          ? val
          : val && typeof val === 'object' && typeof (val as { value?: string }).value === 'string'
            ? (val as { value: string }).value
            : null;

      if (
        preset !== 'center' &&
        preset !== 'topLeft' &&
        preset !== 'topRight' &&
        preset !== 'bottomLeft' &&
        preset !== 'bottomRight' &&
        preset !== 'custom'
      ) {
        return;
      }
      if (preset === 'custom') {
        updateSelectedClipTransform({ anchor: { preset: 'custom', x: 0.5, y: 0.5 } });
      } else {
        updateSelectedClipTransform({ anchor: { preset: preset as ClipAnchorPreset } });
      }
    },
  });

  const transformAnchorX = computed({
    get: () => {
      const staticX = getSafeTransform(options.clip.value).anchor?.x ?? 0.5;
      return options.getAnimatedDisplayValue?.('transform.anchor.x', staticX) ?? staticX;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (current.anchor?.preset !== 'custom') return;
      const x = clampNumber(val, -10, 10);
      if (tryRecordAnimatedEdit('transform.anchor.x', x)) return;
      updateSelectedClipTransform({
        anchor: {
          preset: 'custom',
          x,
          y: current.anchor?.y ?? 0.5,
        },
      });
    },
  });

  const transformAnchorY = computed({
    get: () => {
      const staticY = getSafeTransform(options.clip.value).anchor?.y ?? 0.5;
      return options.getAnimatedDisplayValue?.('transform.anchor.y', staticY) ?? staticY;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (current.anchor?.preset !== 'custom') return;
      const y = clampNumber(val, -10, 10);
      if (tryRecordAnimatedEdit('transform.anchor.y', y)) return;
      updateSelectedClipTransform({
        anchor: {
          preset: 'custom',
          x: current.anchor?.x ?? 0.5,
          y,
        },
      });
    },
  });

  const transformCropTop = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).crop?.top ?? 0;
      return options.getAnimatedDisplayValue?.('transform.crop.top', staticValue) ?? staticValue;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (tryRecordAnimatedEdit('transform.crop.top', val)) return;
      updateSelectedClipTransform({
        crop: { ...(current.crop ?? { top: 0, bottom: 0, left: 0, right: 0 }), top: val },
      });
    },
  });

  const transformCropBottom = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).crop?.bottom ?? 0;
      return (
        options.getAnimatedDisplayValue?.('transform.crop.bottom', staticValue) ?? staticValue
      );
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (tryRecordAnimatedEdit('transform.crop.bottom', val)) return;
      updateSelectedClipTransform({
        crop: { ...(current.crop ?? { top: 0, bottom: 0, left: 0, right: 0 }), bottom: val },
      });
    },
  });

  const transformCropLeft = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).crop?.left ?? 0;
      return options.getAnimatedDisplayValue?.('transform.crop.left', staticValue) ?? staticValue;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (tryRecordAnimatedEdit('transform.crop.left', val)) return;
      updateSelectedClipTransform({
        crop: { ...(current.crop ?? { top: 0, bottom: 0, left: 0, right: 0 }), left: val },
      });
    },
  });

  const transformCropRight = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).crop?.right ?? 0;
      return options.getAnimatedDisplayValue?.('transform.crop.right', staticValue) ?? staticValue;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (tryRecordAnimatedEdit('transform.crop.right', val)) return;
      updateSelectedClipTransform({
        crop: { ...(current.crop ?? { top: 0, bottom: 0, left: 0, right: 0 }), right: val },
      });
    },
  });

  function toggleFlipHorizontal() {
    const current = getSafeTransform(options.clip.value);
    if (tryRecordAnimatedEdit('transform.flipHorizontal', current.flipHorizontal ? 0 : 1)) return;
    updateSelectedClipTransform({ flipHorizontal: !current.flipHorizontal });
  }

  function toggleFlipVertical() {
    const current = getSafeTransform(options.clip.value);
    if (tryRecordAnimatedEdit('transform.flipVertical', current.flipVertical ? 0 : 1)) return;
    updateSelectedClipTransform({ flipVertical: !current.flipVertical });
  }

  function resetScale() {
    const xAnimated = tryRecordAnimatedEdit('transform.scale.x', 1);
    const yAnimated = tryRecordAnimatedEdit('transform.scale.y', 1);
    if (!xAnimated || !yAnimated) {
      updateSelectedClipTransform({ scale: { x: 1, y: 1, linked: true } });
    }
  }

  function resetPosition() {
    const xAnimated = tryRecordAnimatedEdit('transform.position.x', 0);
    const yAnimated = tryRecordAnimatedEdit('transform.position.y', 0);
    if (!xAnimated || !yAnimated) {
      updateSelectedClipTransform({ position: { x: 0, y: 0 } });
    }
  }

  function resetRotation() {
    if (tryRecordAnimatedEdit('transform.rotationDeg', 0)) return;
    updateSelectedClipTransform({ rotationDeg: 0 });
  }

  function resetAnchor() {
    tryRecordAnimatedEdit('transform.anchor.x', 0.5);
    tryRecordAnimatedEdit('transform.anchor.y', 0.5);
    updateSelectedClipTransform({ anchor: { preset: 'center' } });
  }

  function resetCrop() {
    tryRecordAnimatedEdit('transform.crop.top', 0);
    tryRecordAnimatedEdit('transform.crop.bottom', 0);
    tryRecordAnimatedEdit('transform.crop.left', 0);
    tryRecordAnimatedEdit('transform.crop.right', 0);
    updateSelectedClipTransform({ crop: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  function resetAll() {
    tryRecordAnimatedEdit('transform.scale.x', 1);
    tryRecordAnimatedEdit('transform.scale.y', 1);
    tryRecordAnimatedEdit('transform.position.x', 0);
    tryRecordAnimatedEdit('transform.position.y', 0);
    tryRecordAnimatedEdit('transform.rotationDeg', 0);
    tryRecordAnimatedEdit('transform.anchor.x', 0.5);
    tryRecordAnimatedEdit('transform.anchor.y', 0.5);
    tryRecordAnimatedEdit('transform.crop.top', 0);
    tryRecordAnimatedEdit('transform.crop.bottom', 0);
    tryRecordAnimatedEdit('transform.crop.left', 0);
    tryRecordAnimatedEdit('transform.crop.right', 0);
    tryRecordAnimatedEdit('transform.flipHorizontal', 0);
    tryRecordAnimatedEdit('transform.flipVertical', 0);
    options.updateTransform({
      scale: { x: 1, y: 1, linked: true },
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      anchor: { preset: 'center' },
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
      flipHorizontal: false,
      flipVertical: false,
    });
  }

  const transformFlipHorizontal = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).flipHorizontal ? 1 : 0;
      return (
        (options.getAnimatedDisplayValue?.('transform.flipHorizontal', staticValue) ??
          staticValue) >= 0.5
      );
    },
    set: (val: boolean) => {
      if (tryRecordAnimatedEdit('transform.flipHorizontal', val ? 1 : 0)) return;
      updateSelectedClipTransform({ flipHorizontal: Boolean(val) });
    },
  });

  const transformFlipVertical = computed({
    get: () => {
      const staticValue = getSafeTransform(options.clip.value).flipVertical ? 1 : 0;
      return (
        (options.getAnimatedDisplayValue?.('transform.flipVertical', staticValue) ??
          staticValue) >= 0.5
      );
    },
    set: (val: boolean) => {
      if (tryRecordAnimatedEdit('transform.flipVertical', val ? 1 : 0)) return;
      updateSelectedClipTransform({ flipVertical: Boolean(val) });
    },
  });

  return {
    anchorPresetOptions,
    canEditTransform,
    toggleFlipHorizontal,
    toggleFlipVertical,
    transformAnchorPreset,
    transformAnchorX,
    transformAnchorY,
    transformPosX,
    transformPosY,
    transformRotationDeg,
    transformScaleLinked,
    transformScaleX,
    transformScaleY,
    transformCropTop,
    transformCropBottom,
    transformCropLeft,
    transformCropRight,
    transformFlipHorizontal,
    transformFlipVertical,
    resetScale,
    resetPosition,
    resetRotation,
    resetAnchor,
    resetCrop,
    resetAll,
  };
}
