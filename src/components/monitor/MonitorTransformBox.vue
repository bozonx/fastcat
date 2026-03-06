<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import type { ClipTransform } from '~/timeline/types';
import { computeClipBoxLayout, TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';

const props = defineProps<{
  renderWidth: number;
  renderHeight: number;
}>();

const selectionStore = useSelectionStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const { rawWorkerTimelineClips } = useMonitorTimeline();

const selectedClipId = computed(() => {
  const entity = selectionStore.selectedEntity;
  return entity?.kind === 'clip' ? entity.itemId : null;
});

const selectedTrackId = computed(() => {
  const entity = selectionStore.selectedEntity;
  return entity?.kind === 'clip' ? entity.trackId : null;
});

const clipData = computed(() => {
  if (!selectedClipId.value) return null;
  return rawWorkerTimelineClips.value.find((c) => c.id === selectedClipId.value) || null;
});

const intrinsicDimensions = computed(() => {
  if (!clipData.value) return null;

  const type = clipData.value.clipType;
  if (type === 'background' || type === 'text' || type === 'adjustment') {
    return { w: props.renderWidth, h: props.renderHeight };
  }

  const sourcePath = clipData.value.source?.path;
  if (!sourcePath) return { w: props.renderWidth, h: props.renderHeight };

  const meta = mediaStore.mediaMetadata[sourcePath];
  if (!meta) return { w: props.renderWidth, h: props.renderHeight };

  if (meta.video) {
    const w = meta.video.width || props.renderWidth;
    const h = meta.video.height || props.renderHeight;
    return { w, h };
  }

  return { w: props.renderWidth, h: props.renderHeight };
});

const safeTransform = computed(() => {
  const tr: Partial<ClipTransform> = (clipData.value as any)?.transform || {};
  const scaleX = typeof tr.scale?.x === 'number' && Number.isFinite(tr.scale?.x) ? tr.scale.x : 1;
  const scaleY = typeof tr.scale?.y === 'number' && Number.isFinite(tr.scale?.y) ? tr.scale.y : 1;
  const rotationDeg =
    typeof tr.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;
  const posX =
    typeof tr.position?.x === 'number' && Number.isFinite(tr.position?.x) ? tr.position.x : 0;
  const posY =
    typeof tr.position?.y === 'number' && Number.isFinite(tr.position?.y) ? tr.position.y : 0;

  const preset = tr.anchor?.preset || 'center';
  return {
    scaleX,
    scaleY,
    rotationDeg,
    posX,
    posY,
    anchorPreset: preset,
    anchorX: tr.anchor?.x ?? 0.5,
    anchorY: tr.anchor?.y ?? 0.5,
  };
});

const layout = computed(() => {
  const d = intrinsicDimensions.value;
  if (!d) return null;
  const transform = (clipData.value as any)?.transform as ClipTransform | undefined;
  const boxLayout = computeClipBoxLayout({
    frameWidth: d.w,
    frameHeight: d.h,
    canvasWidth: props.renderWidth,
    canvasHeight: props.renderHeight,
    transform,
  });

  return {
    targetW: boxLayout.targetWidth,
    targetH: boxLayout.targetHeight,
    baseX: boxLayout.baseX,
    baseY: boxLayout.baseY,
    ax: boxLayout.anchorX,
    ay: boxLayout.anchorY,
    anchorAbsX: boxLayout.baseX + boxLayout.anchorOffsetX + boxLayout.stagePositionX,
    anchorAbsY: boxLayout.baseY + boxLayout.anchorOffsetY + boxLayout.stagePositionY,
    scaleX: boxLayout.scaleX,
    scaleY: boxLayout.scaleY,
    rotationDeg: boxLayout.rotationDeg,
    posX: safeTransform.value.posX,
    posY: safeTransform.value.posY,
    designToRenderScaleX: props.renderWidth / TRANSFORM_DESIGN_BASE.width,
    designToRenderScaleY: props.renderHeight / TRANSFORM_DESIGN_BASE.height,
  };
});

const mode = ref<'scale' | 'rotate'>('scale');

function updateTransform(patch: Partial<ClipTransform>) {
  if (!selectedClipId.value || !selectedTrackId.value) return;
  const current = (clipData.value as any)?.transform || {};

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

  timelineStore.updateClipProperties(selectedTrackId.value, selectedClipId.value, {
    transform: next,
  });
}

let pendingTransform: ClipTransform | null = null;
let pendingFrame = 0;

function flushPendingTransform() {
  pendingFrame = 0;
  const next = pendingTransform;
  pendingTransform = null;
  if (!next) return;
  updateTransform(next);
}

function scheduleTransformUpdate(patch: Partial<ClipTransform>) {
  if (!selectedClipId.value || !selectedTrackId.value) return;

  const current = pendingTransform ?? ((clipData.value as any)?.transform as ClipTransform | undefined) ?? {};
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

  pendingTransform = next;
  if (pendingFrame !== 0) return;
  pendingFrame = requestAnimationFrame(flushPendingTransform);
}

const isDragging = ref(false);
let dragStartPos = { x: 0, y: 0 };
let dragStartTransform = {
  posX: 0,
  posY: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
  ax: 0.5,
  ay: 0.5,
};
let dragType = ''; // 'translate', 'rotate', 'scale-tl', 'scale-tr', etc.
let activePointerId: number | null = null;
let dragMoved = false;
let dragSourceEl: HTMLElement | null = null;
let dragSvgEl: SVGSVGElement | null = null;

function cleanupDragListeners() {
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
  window.removeEventListener('pointercancel', onWindowPointerCancel);
}

function endDrag(event?: PointerEvent) {
  cleanupDragListeners();

  if (dragSourceEl && activePointerId !== null) {
    try {
      dragSourceEl.releasePointerCapture(activePointerId);
    } catch {
      // ignore
    }
  }

  if (pendingFrame !== 0) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
  flushPendingTransform();

  const shouldToggleMode =
    event &&
    !dragMoved &&
    (dragType === 'translate' || dragType === 'rotate') &&
    Math.abs(event.clientX - dragStartPos.x) < 3 &&
    Math.abs(event.clientY - dragStartPos.y) < 3;

  isDragging.value = false;
  activePointerId = null;
  dragSourceEl = null;
  dragSvgEl = null;

  if (shouldToggleMode) {
    mode.value = mode.value === 'scale' ? 'rotate' : 'scale';
  }
}

function onPointerDown(e: PointerEvent, type: string) {
  if (!layout.value) return;
  if (e.button !== 0) return;
  e.stopPropagation();

  const target = e.currentTarget as HTMLElement | null;
  const svgEl = target?.closest('svg') as SVGSVGElement | null;

  activePointerId = e.pointerId;
  dragSourceEl = target;
  dragSvgEl = svgEl;

  target?.setPointerCapture(e.pointerId);
  isDragging.value = true;
  dragMoved = false;
  dragType = type;
  dragStartPos = { x: e.clientX, y: e.clientY };

  const t = safeTransform.value;
  dragStartTransform = {
    posX: t.posX,
    posY: t.posY,
    rotationDeg: t.rotationDeg,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    ax: layout.value.ax,
    ay: layout.value.ay,
  };

  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
}

// Convert screen drag delta to monitor viewport coordinate delta
// Because this SVG overlay might be scaled via canvas transform in MonitorViewport,
// a movement of 1px on screen might correspond to more/less in renderWidth space.
// We get the SVG bounding rect to determine the scale.
function getViewportDelta(e: PointerEvent, startEventX: number, startEventY: number) {
  const svgMenu = dragSvgEl;
  if (!svgMenu) return { dx: e.clientX - startEventX, dy: e.clientY - startEventY };

  const rect = svgMenu.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { dx: e.clientX - startEventX, dy: e.clientY - startEventY };
  }

  const screenToRenderScaleX = props.renderWidth / rect.width;
  const screenToRenderScaleY = props.renderHeight / rect.height;

  return {
    dx: (e.clientX - startEventX) * screenToRenderScaleX,
    dy: (e.clientY - startEventY) * screenToRenderScaleY,
  };
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value || !layout.value) return;
  if (activePointerId !== null && e.pointerId !== activePointerId) return;

  const { dx, dy } = getViewportDelta(e, dragStartPos.x, dragStartPos.y);
  if (!dragMoved && (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)) {
    dragMoved = true;
  }

  const designDx =
    layout.value.designToRenderScaleX !== 0 ? dx / layout.value.designToRenderScaleX : dx;
  const designDy =
    layout.value.designToRenderScaleY !== 0 ? dy / layout.value.designToRenderScaleY : dy;

  if (dragType === 'translate') {
    scheduleTransformUpdate({
      position: { x: dragStartTransform.posX + designDx, y: dragStartTransform.posY + designDy },
    });
  } else if (dragType === 'rotate' || (mode.value === 'rotate' && dragType.startsWith('rotate'))) {
    const centerX = layout.value.anchorAbsX;
    const centerY = layout.value.anchorAbsY;
    const startAngle = Math.atan2(dragStartPos.y - centerY, dragStartPos.x - centerX);
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const rotationDelta = ((currentAngle - startAngle) * 180) / Math.PI;
    scheduleTransformUpdate({ rotationDeg: dragStartTransform.rotationDeg + rotationDelta });
  } else if (dragType.startsWith('scale')) {
    const rad = (-dragStartTransform.rotationDeg * Math.PI) / 180;
    const ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ldy = dx * Math.sin(rad) + dy * Math.cos(rad);

    let newScaleX = dragStartTransform.scaleX;
    let newScaleY = dragStartTransform.scaleY;

    const w = layout.value.targetW;
    const h = layout.value.targetH;

    const dScaleX = ldx / w;
    const dScaleY = ldy / h;

    if (dragType === 'scale-r') {
      newScaleX += dScaleX;
    } else if (dragType === 'scale-l') {
      newScaleX -= dScaleX;
    } else if (dragType === 'scale-b') {
      newScaleY += dScaleY;
    } else if (dragType === 'scale-t') {
      newScaleY -= dScaleY;
    } else {
      let scaleDelta = 0;
      if (dragType === 'scale-tr') scaleDelta = (dScaleX - dScaleY) / 2;
      else if (dragType === 'scale-tl') scaleDelta = (-dScaleX - dScaleY) / 2;
      else if (dragType === 'scale-br') scaleDelta = (dScaleX + dScaleY) / 2;
      else if (dragType === 'scale-bl') scaleDelta = (-dScaleX + dScaleY) / 2;

      const ratio =
        newScaleX !== 0 ? Math.abs(dragStartTransform.scaleY / dragStartTransform.scaleX) : 1;
      newScaleX += scaleDelta;
      newScaleY = Math.sign(dragStartTransform.scaleY) * Math.abs(newScaleX) * ratio;
    }

    const clampedScaleX = Math.abs(newScaleX) < 0.001 ? Math.sign(newScaleX || 1) * 0.001 : newScaleX;
    const clampedScaleY = Math.abs(newScaleY) < 0.001 ? Math.sign(newScaleY || 1) * 0.001 : newScaleY;

    scheduleTransformUpdate({
      scale: { x: clampedScaleX, y: clampedScaleY, linked: dragType.length > 7 },
    });
  } else if (dragType === 'anchor') {
    const W = layout.value.targetW;
    const H = layout.value.targetH;

    const rad = (-dragStartTransform.rotationDeg * Math.PI) / 180;
    const ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ldy = dx * Math.sin(rad) + dy * Math.cos(rad);

    const W_scaled = dragStartTransform.scaleX !== 0 ? W * dragStartTransform.scaleX : W;
    const H_scaled = dragStartTransform.scaleY !== 0 ? H * dragStartTransform.scaleY : H;

    const dAx = ldx / W_scaled;
    const dAy = ldy / H_scaled;

    const newAx = dragStartTransform.ax + dAx;
    const newAy = dragStartTransform.ay + dAy;

    const deltaPosX =
      layout.value.designToRenderScaleX !== 0
        ? (dx - dAx * W) / layout.value.designToRenderScaleX
        : dx - dAx * W;
    const deltaPosY =
      layout.value.designToRenderScaleY !== 0
        ? (dy - dAy * H) / layout.value.designToRenderScaleY
        : dy - dAy * H;

    scheduleTransformUpdate({
      anchor: { preset: 'custom', x: Math.max(-10, Math.min(10, newAx)), y: Math.max(-10, Math.min(10, newAy)) },
      position: { x: dragStartTransform.posX + deltaPosX, y: dragStartTransform.posY + deltaPosY },
    });
  }
}

function onPointerUp(e: PointerEvent) {
  endDrag(e);
}

function onWindowPointerMove(e: PointerEvent) {
  onPointerMove(e);
}

function onWindowPointerUp(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  onPointerUp(e);
}

function onWindowPointerCancel(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return;
  endDrag(e);
}

onBeforeUnmount(() => {
  cleanupDragListeners();
  if (pendingFrame !== 0) {
    cancelAnimationFrame(pendingFrame);
  }
});

const handles = [
  { type: 'scale-tl', x: 0, y: 0, cursor: 'nwse-resize' },
  { type: 'scale-t', x: 0.5, y: 0, cursor: 'ns-resize' },
  { type: 'scale-tr', x: 1, y: 0, cursor: 'nesw-resize' },
  { type: 'scale-l', x: 0, y: 0.5, cursor: 'ew-resize' },
  { type: 'scale-r', x: 1, y: 0.5, cursor: 'ew-resize' },
  { type: 'scale-bl', x: 0, y: 1, cursor: 'nesw-resize' },
  { type: 'scale-b', x: 0.5, y: 1, cursor: 'ns-resize' },
  { type: 'scale-br', x: 1, y: 1, cursor: 'nwse-resize' },
];
</script>

<template>
  <g v-if="layout" style="pointer-events: auto">
    <g
      :transform="`
        translate(${layout.anchorAbsX}, ${layout.anchorAbsY})
        rotate(${layout.rotationDeg})
        scale(${layout.scaleX}, ${layout.scaleY})
        translate(${-layout.ax * layout.targetW}, ${-layout.ay * layout.targetH})
      `"
    >
      <rect
        x="0"
        y="0"
        :width="layout.targetW"
        :height="layout.targetH"
        fill="rgba(0,0,0,0.01)"
        stroke="var(--ui-primary)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        :cursor="mode === 'rotate' ? 'ew-resize' : 'move'"
        @pointerdown="onPointerDown($event, mode === 'rotate' ? 'rotate' : 'translate')"
      />

      <template v-if="mode === 'scale'">
        <circle
          v-for="h in handles"
          :key="h.type"
          :cx="h.x * layout.targetW"
          :cy="h.y * layout.targetH"
          r="6"
          fill="white"
          stroke="var(--ui-primary)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          :cursor="h.cursor"
          @pointerdown="onPointerDown($event, h.type)"
        />
      </template>
    </g>

    <g
      v-if="mode === 'rotate'"
      :transform="`translate(${layout.anchorAbsX}, ${layout.anchorAbsY})`"
    >
      <circle
        cx="0"
        cy="0"
        r="6"
        fill="white"
        stroke="var(--ui-primary)"
        stroke-width="2"
        cursor="move"
        @pointerdown="onPointerDown($event, 'anchor')"
      />
      <path d="M 0 0 L 0 -30" stroke="var(--ui-primary)" stroke-width="2" stroke-linecap="round" />
      <polygon points="-4,-24 0,-32 4,-24" fill="var(--ui-primary)" />
      <path d="M 0 0 L 30 0" stroke="var(--ui-primary)" stroke-width="2" stroke-linecap="round" />
      <polygon points="24,-4 32,0 24,4" fill="var(--ui-primary)" />
    </g>
  </g>
</template>
