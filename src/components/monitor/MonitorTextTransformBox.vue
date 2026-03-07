<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import type { ClipTransform, TextClipStyle } from '~/timeline/types';
import { computeClipBoxLayout, TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';
import { computeTextLayoutMetrics } from '~/utils/video-editor/text-layout';

const props = defineProps<{
  renderWidth: number;
  renderHeight: number;
}>();

const selectionStore = useSelectionStore();
const timelineStore = useTimelineStore();
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
  const clip = rawWorkerTimelineClips.value.find((item) => item.id === selectedClipId.value) ?? null;
  return clip?.clipType === 'text' ? clip : null;
});

const measureContext =
  typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

const safeTransform = computed(() => {
  const transform: Partial<ClipTransform> = (clipData.value as any)?.transform ?? {};
  return {
    scaleX:
      typeof transform.scale?.x === 'number' && Number.isFinite(transform.scale.x) ? transform.scale.x : 1,
    scaleY:
      typeof transform.scale?.y === 'number' && Number.isFinite(transform.scale.y) ? transform.scale.y : 1,
    rotationDeg:
      typeof transform.rotationDeg === 'number' && Number.isFinite(transform.rotationDeg)
        ? transform.rotationDeg
        : 0,
    posX:
      typeof transform.position?.x === 'number' && Number.isFinite(transform.position.x)
        ? transform.position.x
        : 0,
    posY:
      typeof transform.position?.y === 'number' && Number.isFinite(transform.position.y)
        ? transform.position.y
        : 0,
    anchorPreset: transform.anchor?.preset ?? 'center',
    anchorX: transform.anchor?.x ?? 0.5,
    anchorY: transform.anchor?.y ?? 0.5,
  };
});

const clipLayout = computed(() => {
  if (!clipData.value) return null;

  return computeClipBoxLayout({
    frameWidth: props.renderWidth,
    frameHeight: props.renderHeight,
    canvasWidth: props.renderWidth,
    canvasHeight: props.renderHeight,
    transform: (clipData.value as any).transform as ClipTransform | undefined,
  });
});

const textMetrics = computed(() => {
  if (!clipData.value || !measureContext) return null;

  return computeTextLayoutMetrics({
    text: String((clipData.value as any).text ?? ''),
    style: (clipData.value as any).style,
    canvasWidth: props.renderWidth,
    canvasHeight: props.renderHeight,
    measureText: (text, font) => {
      measureContext.font = font;
      return measureContext.measureText(text).width;
    },
  });
});

const layout = computed(() => {
  if (!clipLayout.value || !textMetrics.value) return null;

  return {
    targetW: clipLayout.value.targetWidth,
    targetH: clipLayout.value.targetHeight,
    ax: clipLayout.value.anchorX,
    ay: clipLayout.value.anchorY,
    anchorAbsX: clipLayout.value.baseX + clipLayout.value.anchorOffsetX + clipLayout.value.stagePositionX,
    anchorAbsY: clipLayout.value.baseY + clipLayout.value.anchorOffsetY + clipLayout.value.stagePositionY,
    scaleX: clipLayout.value.scaleX,
    scaleY: clipLayout.value.scaleY,
    rotationDeg: clipLayout.value.rotationDeg,
    posX: safeTransform.value.posX,
    posY: safeTransform.value.posY,
    designToRenderScaleX: props.renderWidth / TRANSFORM_DESIGN_BASE.width,
    designToRenderScaleY: props.renderHeight / TRANSFORM_DESIGN_BASE.height,
    textBoxX: textMetrics.value.backgroundX,
    textBoxY: textMetrics.value.backgroundY,
    textBoxW: textMetrics.value.backgroundWidth,
    textBoxH: textMetrics.value.backgroundHeight,
    fontSize: textMetrics.value.style.fontSize,
    explicitWidth:
      textMetrics.value.explicitWidthPx !== undefined
        ? textMetrics.value.explicitWidthPx / textMetrics.value.renderScale
        : textMetrics.value.backgroundWidth / textMetrics.value.renderScale,
    renderScale: textMetrics.value.renderScale,
  };
});

const mode = ref<'text' | 'rotate'>('text');

function buildNextTransform(current: any, patch: Partial<ClipTransform>): ClipTransform {
  return {
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
}

function buildNextStyle(current: any, patch: Partial<TextClipStyle>): TextClipStyle {
  return {
    ...(current ?? {}),
    ...patch,
  };
}

function updateClip(params: { transform?: Partial<ClipTransform>; style?: Partial<TextClipStyle> }) {
  if (!selectedClipId.value || !selectedTrackId.value || !clipData.value) return;

  const currentTransform = (clipData.value as any).transform ?? {};
  const currentStyle = (clipData.value as any).style ?? {};
  const nextTransform = params.transform ? buildNextTransform(currentTransform, params.transform) : currentTransform;
  const nextStyle = params.style ? buildNextStyle(currentStyle, params.style) : currentStyle;

  timelineStore.updateClipProperties(selectedTrackId.value, selectedClipId.value, {
    transform: nextTransform,
    style: nextStyle,
  });
}

let pendingTransformPatch: Partial<ClipTransform> | null = null;
let pendingStylePatch: Partial<TextClipStyle> | null = null;
let pendingFrame = 0;

function flushPendingPatch() {
  pendingFrame = 0;
  const transformPatch = pendingTransformPatch;
  const stylePatch = pendingStylePatch;
  pendingTransformPatch = null;
  pendingStylePatch = null;

  if (!transformPatch && !stylePatch) return;

  updateClip({
    transform: transformPatch ?? undefined,
    style: stylePatch ?? undefined,
  });
}

function scheduleClipUpdate(params: { transform?: Partial<ClipTransform>; style?: Partial<TextClipStyle> }) {
  if (params.transform) {
    pendingTransformPatch = {
      ...(pendingTransformPatch ?? {}),
      ...params.transform,
      scale: {
        ...((pendingTransformPatch?.scale as any) ?? {}),
        ...(params.transform.scale ?? {}),
      },
      position: {
        ...((pendingTransformPatch?.position as any) ?? {}),
        ...(params.transform.position ?? {}),
      },
      anchor: {
        ...((pendingTransformPatch?.anchor as any) ?? {}),
        ...(params.transform.anchor ?? {}),
      },
    };
  }

  if (params.style) {
    pendingStylePatch = {
      ...(pendingStylePatch ?? {}),
      ...params.style,
    };
  }

  if (pendingFrame !== 0) return;
  pendingFrame = requestAnimationFrame(flushPendingPatch);
}

const isDragging = ref(false);
let dragType = '';
let dragMoved = false;
let activePointerId: number | null = null;
let dragSourceEl: HTMLElement | null = null;
let dragSvgEl: SVGSVGElement | null = null;
let dragStartPos = { x: 0, y: 0 };
let dragStartState = {
  posX: 0,
  posY: 0,
  rotationDeg: 0,
  width: 0,
  fontSize: 64,
};

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
    }
  }

  if (pendingFrame !== 0) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }
  flushPendingPatch();

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
    mode.value = mode.value === 'text' ? 'rotate' : 'text';
  }
}

function onPointerDown(event: PointerEvent, type: string) {
  if (!layout.value) return;
  if (event.button !== 0) return;
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement | null;
  const svgElement = target?.closest('svg') as SVGSVGElement | null;

  activePointerId = event.pointerId;
  dragSourceEl = target;
  dragSvgEl = svgElement;
  target?.setPointerCapture(event.pointerId);

  isDragging.value = true;
  dragMoved = false;
  dragType = type;
  dragStartPos = { x: event.clientX, y: event.clientY };
  dragStartState = {
    posX: layout.value.posX,
    posY: layout.value.posY,
    rotationDeg: layout.value.rotationDeg,
    width: layout.value.explicitWidth,
    fontSize: layout.value.fontSize,
  };

  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerCancel);
}

function getViewportDelta(event: PointerEvent) {
  if (!dragSvgEl) {
    return { dx: event.clientX - dragStartPos.x, dy: event.clientY - dragStartPos.y };
  }

  const rect = dragSvgEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { dx: event.clientX - dragStartPos.x, dy: event.clientY - dragStartPos.y };
  }

  return {
    dx: (event.clientX - dragStartPos.x) * (props.renderWidth / rect.width),
    dy: (event.clientY - dragStartPos.y) * (props.renderHeight / rect.height),
  };
}

function onPointerMove(event: PointerEvent) {
  if (!layout.value || !isDragging.value) return;
  if (activePointerId !== null && event.pointerId !== activePointerId) return;

  const { dx, dy } = getViewportDelta(event);
  if (!dragMoved && (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)) {
    dragMoved = true;
  }

  const designDx = layout.value.designToRenderScaleX !== 0 ? dx / layout.value.designToRenderScaleX : dx;
  const designDy = layout.value.designToRenderScaleY !== 0 ? dy / layout.value.designToRenderScaleY : dy;
  const rad = (-dragStartState.rotationDeg * Math.PI) / 180;
  const localDx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localDy = dx * Math.sin(rad) + dy * Math.cos(rad);
  const effectiveScaleX = Math.abs(layout.value.scaleX) < 0.001 ? 1 : layout.value.scaleX;
  const effectiveScaleY = Math.abs(layout.value.scaleY) < 0.001 ? 1 : layout.value.scaleY;
  const unscaledLocalDx = localDx / effectiveScaleX;
  const unscaledLocalDy = localDy / effectiveScaleY;

  if (dragType === 'translate') {
    scheduleClipUpdate({
      transform: {
        position: {
          x: dragStartState.posX + designDx,
          y: dragStartState.posY + designDy,
        },
      },
    });
    return;
  }

  if (dragType === 'rotate' || (mode.value === 'rotate' && dragType === 'rotate-handle')) {
    const centerX = layout.value.anchorAbsX;
    const centerY = layout.value.anchorAbsY;
    const startAngle = Math.atan2(dragStartPos.y - centerY, dragStartPos.x - centerX);
    const currentAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    const rotationDelta = ((currentAngle - startAngle) * 180) / Math.PI;
    scheduleClipUpdate({
      transform: {
        rotationDeg: dragStartState.rotationDeg + rotationDelta,
      },
    });
    return;
  }

  if (dragType === 'width-left' || dragType === 'width-right') {
    const widthDeltaRender = dragType === 'width-left' ? -unscaledLocalDx : unscaledLocalDx;
    const widthDeltaDesign = layout.value.renderScale !== 0 ? widthDeltaRender / layout.value.renderScale : widthDeltaRender;
    const nextWidth = Math.max(1, Math.round(dragStartState.width + widthDeltaDesign));
    scheduleClipUpdate({
      style: {
        width: nextWidth,
      },
    });
    return;
  }

  if (dragType === 'font-size') {
    const fontSizeDelta = layout.value.renderScale !== 0 ? unscaledLocalDy / layout.value.renderScale : unscaledLocalDy;
    const nextFontSize = Math.max(1, Math.min(1000, Math.round(dragStartState.fontSize + fontSizeDelta)));
    scheduleClipUpdate({
      style: {
        fontSize: nextFontSize,
      },
    });
  }
}

function onWindowPointerMove(event: PointerEvent) {
  onPointerMove(event);
}

function onWindowPointerUp(event: PointerEvent) {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  endDrag(event);
}

function onWindowPointerCancel(event: PointerEvent) {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  endDrag(event);
}

onBeforeUnmount(() => {
  cleanupDragListeners();
  if (pendingFrame !== 0) {
    cancelAnimationFrame(pendingFrame);
  }
});
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
        :x="layout.textBoxX"
        :y="layout.textBoxY"
        :width="layout.textBoxW"
        :height="layout.textBoxH"
        fill="rgba(0,0,0,0.01)"
        stroke="var(--ui-primary)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        :cursor="mode === 'rotate' ? 'grab' : 'move'"
        @pointerdown="onPointerDown($event, mode === 'rotate' ? 'rotate' : 'translate')"
      />

      <template v-if="mode === 'text'">
        <rect
          :x="layout.textBoxX - 5"
          :y="layout.textBoxY + layout.textBoxH / 2 - 12"
          width="10"
          height="24"
          rx="3"
          fill="white"
          stroke="var(--ui-primary)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          cursor="ew-resize"
          @pointerdown="onPointerDown($event, 'width-left')"
        />
        <rect
          :x="layout.textBoxX + layout.textBoxW - 5"
          :y="layout.textBoxY + layout.textBoxH / 2 - 12"
          width="10"
          height="24"
          rx="3"
          fill="white"
          stroke="var(--ui-primary)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          cursor="ew-resize"
          @pointerdown="onPointerDown($event, 'width-right')"
        />
        <circle
          :cx="layout.textBoxX + layout.textBoxW"
          :cy="layout.textBoxY + layout.textBoxH"
          r="7"
          fill="white"
          stroke="var(--ui-primary)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          cursor="ns-resize"
          @pointerdown="onPointerDown($event, 'font-size')"
        />
      </template>
    </g>

    <g v-if="mode === 'rotate'" :transform="`translate(${layout.anchorAbsX}, ${layout.anchorAbsY})`">
      <path d="M 0 0 L 0 -30" stroke="var(--ui-primary)" stroke-width="2" stroke-linecap="round" />
      <circle
        cx="0"
        cy="-38"
        r="6"
        fill="white"
        stroke="var(--ui-primary)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        cursor="grab"
        @pointerdown="onPointerDown($event, 'rotate-handle')"
      />
    </g>
  </g>
</template>
