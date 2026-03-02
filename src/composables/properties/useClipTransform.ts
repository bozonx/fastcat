import { computed, type Ref } from 'vue';
import type { ClipTransform, TimelineClipItem } from '~/timeline/types';

interface UseClipTransformOptions {
  clip: Ref<TimelineClipItem>;
  updateTransform: (next: ClipTransform) => void;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}

function getSafeTransform(clip: TimelineClipItem): ClipTransform {
  const tr = (clip as any).transform ?? {};
  const scaleRaw = tr.scale ?? {};
  const scaleX = typeof scaleRaw.x === 'number' && Number.isFinite(scaleRaw.x) ? scaleRaw.x : 1;
  const scaleY = typeof scaleRaw.y === 'number' && Number.isFinite(scaleRaw.y) ? scaleRaw.y : 1;
  const linked = Boolean(scaleRaw.linked);

  const positionRaw = tr.position ?? {};
  const posX =
    typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0;
  const posY =
    typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0;

  const rotationDeg =
    typeof tr.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;

  const anchorRaw = tr.anchor ?? {};
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

  return {
    scale: {
      x: clampNumber(scaleX, 0.001, 1000),
      y: clampNumber(scaleY, 0.001, 1000),
      linked,
    },
    position: {
      x: clampNumber(posX, -1_000_000, 1_000_000),
      y: clampNumber(posY, -1_000_000, 1_000_000),
    },
    rotationDeg: clampNumber(rotationDeg, -36000, 36000),
    anchor:
      preset === 'custom'
        ? { preset, x: clampNumber(anchorX, 0, 1), y: clampNumber(anchorY, 0, 1) }
        : { preset },
  };
}

export function useClipTransform(options: UseClipTransformOptions) {
  const canEditTransform = computed(() => {
    return options.clip.value.trackId.startsWith('v');
  });

  const anchorPresetOptions = computed(() => [
    { value: 'center', label: 'Center' },
    { value: 'topLeft', label: 'Top Left' },
    { value: 'topRight', label: 'Top Right' },
    { value: 'bottomLeft', label: 'Bottom Left' },
    { value: 'bottomRight', label: 'Bottom Right' },
    { value: 'custom', label: 'Custom' },
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
    };

    options.updateTransform(next);
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
      return getSafeTransform(options.clip.value).scale?.x ?? 1;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      const linked = Boolean(current.scale?.linked);
      const x = clampNumber(val, 0.001, 1000);
      const y = linked ? x : (current.scale?.y ?? 1);
      updateSelectedClipTransform({ scale: { x, y, linked } });
    },
  });

  const transformScaleY = computed({
    get: () => {
      return getSafeTransform(options.clip.value).scale?.y ?? 1;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      const linked = Boolean(current.scale?.linked);
      const y = clampNumber(val, 0.001, 1000);
      const x = linked ? y : (current.scale?.x ?? 1);
      updateSelectedClipTransform({ scale: { x, y, linked } });
    },
  });

  const transformRotationDeg = computed({
    get: () => {
      return getSafeTransform(options.clip.value).rotationDeg ?? 0;
    },
    set: (val: number) => {
      updateSelectedClipTransform({ rotationDeg: clampNumber(val, -36000, 36000) });
    },
  });

  const transformPosX = computed({
    get: () => {
      return getSafeTransform(options.clip.value).position?.x ?? 0;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      updateSelectedClipTransform({
        position: { x: clampNumber(val, -1_000_000, 1_000_000), y: current.position?.y ?? 0 },
      });
    },
  });

  const transformPosY = computed({
    get: () => {
      return getSafeTransform(options.clip.value).position?.y ?? 0;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      updateSelectedClipTransform({
        position: { x: current.position?.x ?? 0, y: clampNumber(val, -1_000_000, 1_000_000) },
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
          : val && typeof val === 'object' && typeof (val as any).value === 'string'
            ? ((val as any).value as string)
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
        updateSelectedClipTransform({ anchor: { preset: preset as any } });
      }
    },
  });

  const transformAnchorX = computed({
    get: () => {
      return getSafeTransform(options.clip.value).anchor?.x ?? 0.5;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (current.anchor?.preset !== 'custom') return;
      updateSelectedClipTransform({
        anchor: {
          preset: 'custom',
          x: clampNumber(val, 0, 1),
          y: current.anchor?.y ?? 0.5,
        },
      });
    },
  });

  const transformAnchorY = computed({
    get: () => {
      return getSafeTransform(options.clip.value).anchor?.y ?? 0.5;
    },
    set: (val: number) => {
      const current = getSafeTransform(options.clip.value);
      if (current.anchor?.preset !== 'custom') return;
      updateSelectedClipTransform({
        anchor: {
          preset: 'custom',
          x: current.anchor?.x ?? 0.5,
          y: clampNumber(val, 0, 1),
        },
      });
    },
  });

  return {
    anchorPresetOptions,
    canEditTransform,
    transformAnchorPreset,
    transformAnchorX,
    transformAnchorY,
    transformPosX,
    transformPosY,
    transformRotationDeg,
    transformScaleLinked,
    transformScaleX,
    transformScaleY,
  };
}
