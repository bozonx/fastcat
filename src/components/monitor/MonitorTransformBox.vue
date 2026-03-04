<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import type { ClipTransform } from '~/timeline/types';
import { clampNumber } from '~/utils/audio/envelope';

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
  const rotationDeg = typeof tr.rotationDeg === 'number' && Number.isFinite(tr.rotationDeg) ? tr.rotationDeg : 0;
  const posX = typeof tr.position?.x === 'number' && Number.isFinite(tr.position?.x) ? tr.position.x : 0;
  const posY = typeof tr.position?.y === 'number' && Number.isFinite(tr.position?.y) ? tr.position.y : 0;
  
  const preset = tr.anchor?.preset || 'center';
  return { scaleX, scaleY, rotationDeg, posX, posY, anchorPreset: preset, anchorX: tr.anchor?.x ?? 0.5, anchorY: tr.anchor?.y ?? 0.5 };
});

const layout = computed(() => {
  const d = intrinsicDimensions.value;
  if (!d) return null;
  
  const frameW = d.w;
  const frameH = d.h;
  const viewportScale = Math.min(props.renderWidth / Math.max(1, frameW), props.renderHeight / Math.max(1, frameH));
  const targetW = frameW * viewportScale;
  const targetH = frameH * viewportScale;
  const baseX = (props.renderWidth - targetW) / 2;
  const baseY = (props.renderHeight - targetH) / 2;

  const t = safeTransform.value;
  let ax = 0.5; let ay = 0.5;
  switch (t.anchorPreset) {
    case 'topLeft': ax = 0; ay = 0; break;
    case 'topRight': ax = 1; ay = 0; break;
    case 'bottomLeft': ax = 0; ay = 1; break;
    case 'bottomRight': ax = 1; ay = 1; break;
    case 'custom': ax = t.anchorX; ay = t.anchorY; break;
    case 'center': default: ax = 0.5; ay = 0.5; break;
  }

  const anchorAbsX = baseX + ax * targetW + t.posX;
  const anchorAbsY = baseY + ay * targetH + t.posY;
  
  return {
    targetW, targetH, baseX, baseY, ax, ay,
    anchorAbsX, anchorAbsY,
    scaleX: t.scaleX, scaleY: t.scaleY,
    rotationDeg: t.rotationDeg,
    posX: t.posX, posY: t.posY,
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
  
  timelineStore.updateClipProperties(selectedTrackId.value, selectedClipId.value, { transform: next });
}

const isDragging = ref(false);
let dragStartPos = { x: 0, y: 0 };
let dragStartTransform = { posX: 0, posY: 0, rotationDeg: 0, scaleX: 1, scaleY: 1, ax: 0.5, ay: 0.5 };
let dragType = ''; // 'translate', 'rotate', 'scale-tl', 'scale-tr', etc.

function onPointerDown(e: PointerEvent, type: string) {
  if (!layout.value) return;
  e.stopPropagation();
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  isDragging.value = true;
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
    ay: layout.value.ay
  };
}

// Convert screen drag delta to monitor viewport coordinate delta
// Because this SVG overlay might be scaled via canvas transform in MonitorViewport, 
// a movement of 1px on screen might correspond to more/less in renderWidth space.
// We get the SVG bounding rect to determine the scale.
function getViewportDelta(e: PointerEvent, startEventX: number, startEventY: number) {
  const currentTarget = e.currentTarget as Element;
  const svgMenu = currentTarget.closest('svg');
  if (!svgMenu) return { dx: e.clientX - startEventX, dy: e.clientY - startEventY };

  const rect = svgMenu.getBoundingClientRect();
  const screenToRenderScaleX = props.renderWidth / rect.width;
  const screenToRenderScaleY = props.renderHeight / rect.height;

  return {
    dx: (e.clientX - startEventX) * screenToRenderScaleX,
    dy: (e.clientY - startEventY) * screenToRenderScaleY,
  };
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value || !layout.value) return;
  
  // Convert mouse movement to renderWidth/renderHeight space
  const { dx, dy } = getViewportDelta(e, dragStartPos.x, dragStartPos.y);

  if (dragType === 'translate') {
    updateTransform({ position: { x: dragStartTransform.posX + dx, y: dragStartTransform.posY + dy } });
  } else if (dragType === 'rotate' || mode.value === 'rotate' && dragType.startsWith('rotate')) {
    // Rotating around anchor Abs
    // Wait, requirement: "drag на любом месте вращает при движении мышки по оси x"
    const rotationDelta = dx * 0.5; // roughly 0.5 degree per pixel
    updateTransform({ rotationDeg: dragStartTransform.rotationDeg + rotationDelta });
  } else if (dragType.startsWith('scale')) {
    // Proportional or non-proportional based on handle
    // Actually the requirement: 
    // "точки по краям по центру отрезка для изменения масштаба по x,y"
    // "точки по углам для изменения масштаба пропорционально"
    let localDx = dx;
    let localDy = dy;
    
    // Rotate the delta back into the local space of the unrotated box to scale properly
    const rad = -dragStartTransform.rotationDeg * Math.PI / 180;
    const ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ldy = dx * Math.sin(rad) + dy * Math.cos(rad);

    let newScaleX = dragStartTransform.scaleX;
    let newScaleY = dragStartTransform.scaleY;

    // targetW, targetH is the size before scaling
    const w = layout.value.targetW;
    const h = layout.value.targetH;
    
    // How much scale changed
    const dScaleX = ldx / w;
    const dScaleY = ldy / h;

    // Depending on which handle, we apply the change
    if (dragType === 'scale-r') { newScaleX += dScaleX; }
    else if (dragType === 'scale-l') { newScaleX -= dScaleX; }
    else if (dragType === 'scale-b') { newScaleY += dScaleY; }
    else if (dragType === 'scale-t') { newScaleY -= dScaleY; }
    else {
      // Corners - proportional scaling. 
      // Pick the major dragging axis relative to the handle
      let scaleDelta = 0;
      if (dragType === 'scale-tr') scaleDelta = (dScaleX - dScaleY) / 2;
      else if (dragType === 'scale-tl') scaleDelta = (-dScaleX - dScaleY) / 2;
      else if (dragType === 'scale-br') scaleDelta = (dScaleX + dScaleY) / 2;
      else if (dragType === 'scale-bl') scaleDelta = (-dScaleX + dScaleY) / 2;
      
      const ratio = newScaleX !== 0 ? Math.abs(dragStartTransform.scaleY / dragStartTransform.scaleX) : 1;
      // Proportional: 
      newScaleX += scaleDelta;
      newScaleY = Math.sign(dragStartTransform.scaleY) * Math.abs(newScaleX) * ratio;
    }

    updateTransform({ scale: { x: newScaleX, y: newScaleY, linked: dragType.length > 7 }}); // >7 handles corners
  } else if (dragType === 'anchor') {
    // Update custom anchor
    // We convert local motion scaled to anchor domain (0-1)
    const w = layout.value.targetW * dragStartTransform.scaleX;
    const h = layout.value.targetH * dragStartTransform.scaleY;
    
    const rad = -dragStartTransform.rotationDeg * Math.PI / 180;
    const ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ldy = dx * Math.sin(rad) + dy * Math.cos(rad);

    const dAx = ldx / w;
    const dAy = ldy / h;
    
    updateTransform({ anchor: { preset: 'custom', x: dragStartTransform.ax + dAx, y: dragStartTransform.ay + dAy }});
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  
  // If clicked without dragging, toggle mode
  const dx = e.clientX - dragStartPos.x;
  const dy = e.clientY - dragStartPos.y;
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && dragType === 'translate') {
    mode.value = mode.value === 'scale' ? 'rotate' : 'scale';
  }
}

// 8 handle points around the target size: top-left, top-right, bottom-left, bottom-right, and middle of sides.
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
  <g v-if="layout" style="pointer-events: auto;">
    <!-- Apply the transform exactly as in PIXI to map coordinates correctly -->
    <g
      :transform="`
        translate(${layout.anchorAbsX}, ${layout.anchorAbsY})
        rotate(${layout.rotationDeg})
        scale(${layout.scaleX}, ${layout.scaleY})
        translate(${-layout.ax * layout.targetW}, ${-layout.ay * layout.targetH})
      `"
    >
      <!-- The inner box represents the clip boundary -->
      <!-- We add a transparent rect here to capture drag events on the clip surface -->
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
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />

      <!-- Mode: Scale - show 8 handles -->
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
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
        />
      </template>
    </g>
    
    <!-- Mode: Rotate - show anchor. We draw the anchor in Absolute coordinates to not undergo scaling! -->
    <!-- So the user can drag it without it looking weird when scaled highly -->
    <g v-if="mode === 'rotate'" :transform="`translate(${layout.anchorAbsX}, ${layout.anchorAbsY})`">
      <circle
        cx="0"
        cy="0"
        r="6"
        fill="white"
        stroke="var(--ui-primary)"
        stroke-width="2"
        cursor="move"
        @pointerdown="onPointerDown($event, 'anchor')"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      />
      <!-- Axes with arrows as requested: "точка и 2мя осями уходящими вправа и вверх и кончающимися меленькими стрелками" -->
      <!-- Up Arrow -->
      <path d="M 0 0 L 0 -30" stroke="var(--ui-primary)" stroke-width="2" stroke-linecap="round" />
      <polygon points="-4,-24 0,-32 4,-24" fill="var(--ui-primary)" />
      <!-- Right Arrow -->
      <path d="M 0 0 L 30 0" stroke="var(--ui-primary)" stroke-width="2" stroke-linecap="round" />
      <polygon points="24,-4 32,0 24,4" fill="var(--ui-primary)" />
    </g>
  </g>
</template>
