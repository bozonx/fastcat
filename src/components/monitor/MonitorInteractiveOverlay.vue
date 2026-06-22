<script setup lang="ts">
import { computed } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMonitorTimeline } from '~/composables/monitor/useMonitorTimeline';
import type { ClipSourceOrientation, ClipTransform, TextClipStyle } from '~/timeline/types';
import type { WorkerTimelineClip } from '~/composables/monitor/types';
import { computeClipBoxLayout } from '~/utils/video-editor/clip-layout';
import { computeTextLayoutMetrics } from '~/utils/video-editor/text-layout';

const props = defineProps<{
  renderWidth: number;
  renderHeight: number;
}>();

const selectionStore = useSelectionStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const { rawWorkerTimelineClips } = useMonitorTimeline();

const currentTimeUs = computed(() => timelineStore.currentTime);

const visibleClips = computed(() =>
  rawWorkerTimelineClips.value.filter((clip) => {
    // Adjustment clips always cover the project frame and have no useful
    // direct manipulation target. Their full-frame dashed hit box only looks
    // like a canvas render artifact.
    if (clip.clipType === 'adjustment') return false;

    const startUs = clip.timelineRange.startUs;
    const endUs = startUs + clip.timelineRange.durationUs;
    return currentTimeUs.value >= startUs && currentTimeUs.value < endUs;
  }),
);

function getSourceRotation(clip: WorkerTimelineClip): number {
  const sourceOrientation = (clip as { sourceOrientation?: ClipSourceOrientation })
    .sourceOrientation;
  if (sourceOrientation && sourceOrientation !== 'auto') {
    return Number(sourceOrientation);
  }
  const sourcePath = clip.source?.path;
  if (!sourcePath) return 0;
  const meta = mediaStore.getCachedMetadata(sourcePath);
  return meta?.video?.rotation ?? 0;
}

function getIntrinsicDimensions(clip: WorkerTimelineClip): { w: number; h: number } {
  const type = clip.clipType;
  if (type === 'background' || type === 'text' || type === 'adjustment' || type === 'hud') {
    return { w: props.renderWidth, h: props.renderHeight };
  }

  if (type === 'shape') {
    const strokeWidth = (clip as { strokeWidth?: number }).strokeWidth ?? 0;
    const size = Math.min(props.renderWidth, props.renderHeight) * 0.8;
    const targetW = Math.max(1, Math.ceil(size + strokeWidth * 2));
    const targetH = Math.max(1, Math.ceil(size + strokeWidth * 2));
    return { w: targetW, h: targetH };
  }

  const sourcePath = clip.source?.path;
  if (!sourcePath) return { w: props.renderWidth, h: props.renderHeight };

  const meta = mediaStore.getCachedMetadata(sourcePath);
  if (!meta) return { w: props.renderWidth, h: props.renderHeight };

  if (meta.video) {
    const w = meta.video.width || meta.video.displayWidth || props.renderWidth;
    const h = meta.video.height || meta.video.displayHeight || props.renderHeight;
    return { w, h };
  }

  if (meta.image?.width && meta.image?.height) {
    return { w: meta.image.width, h: meta.image.height };
  }

  return { w: props.renderWidth, h: props.renderHeight };
}

const measureContext =
  typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

const designSize = computed(() => ({
  width: timelineStore.timelineFormat?.width ?? projectStore.projectSettings.project.width,
  height: timelineStore.timelineFormat?.height ?? projectStore.projectSettings.project.height,
}));

interface BboxItem {
  clip: WorkerTimelineClip;
  transform: string;
  targetW: number;
  targetH: number;
  textBoxX?: number;
  textBoxY?: number;
  textBoxW?: number;
  textBoxH?: number;
}

const bboxItems = computed(() => {
  if (!workspaceStore.userSettings.experimentalFeatures) return [];

  const items: BboxItem[] = [];

  for (const clip of visibleClips.value) {
    const dims = getIntrinsicDimensions(clip);
    const transform = (clip as { transform?: ClipTransform }).transform;
    const rotation = getSourceRotation(clip);

    if (clip.clipType === 'text') {
      if (!measureContext) continue;

      const textMetrics = computeTextLayoutMetrics({
        text: String((clip as { text?: string }).text ?? ''),
        style: (clip as { style?: TextClipStyle }).style,
        canvasWidth: props.renderWidth,
        canvasHeight: props.renderHeight,
        designWidth: designSize.value.width,
        designHeight: designSize.value.height,
        measureText: (text, font) => {
          measureContext.font = font;
          return measureContext.measureText(text).width;
        },
      });

      const clipLayout = computeClipBoxLayout({
        frameWidth: props.renderWidth,
        frameHeight: props.renderHeight,
        canvasWidth: props.renderWidth,
        canvasHeight: props.renderHeight,
        transform,
      });

      items.push({
        clip,
        transform: `translate(${clipLayout.baseX + clipLayout.anchorOffsetX + clipLayout.stagePositionX}, ${clipLayout.baseY + clipLayout.anchorOffsetY + clipLayout.stagePositionY}) rotate(${clipLayout.rotationDeg}) scale(${clipLayout.scaleX}, ${clipLayout.scaleY}) translate(${-clipLayout.anchorX * clipLayout.targetWidth}, ${-clipLayout.anchorY * clipLayout.targetHeight})`,
        targetW: clipLayout.targetWidth,
        targetH: clipLayout.targetHeight,
        textBoxX: textMetrics.backgroundX,
        textBoxY: textMetrics.backgroundY,
        textBoxW: textMetrics.backgroundWidth,
        textBoxH: textMetrics.backgroundHeight,
      });
    } else {
      const clipLayout = computeClipBoxLayout({
        frameWidth: dims.w,
        frameHeight: dims.h,
        canvasWidth: props.renderWidth,
        canvasHeight: props.renderHeight,
        fitRotationDeg: rotation,
        transform: {
          ...(transform ?? {}),
          rotationDeg: (transform?.rotationDeg ?? 0) + rotation,
        },
      });

      items.push({
        clip,
        transform: `translate(${clipLayout.baseX + clipLayout.anchorOffsetX + clipLayout.stagePositionX}, ${clipLayout.baseY + clipLayout.anchorOffsetY + clipLayout.stagePositionY}) rotate(${clipLayout.rotationDeg}) scale(${clipLayout.scaleX}, ${clipLayout.scaleY}) translate(${-clipLayout.anchorX * clipLayout.targetWidth}, ${-clipLayout.anchorY * clipLayout.targetHeight})`,
        targetW: clipLayout.targetWidth,
        targetH: clipLayout.targetHeight,
      });
    }
  }

  return items;
});

function selectClip(clip: WorkerTimelineClip) {
  selectionStore.selectTimelineItem(clip.trackId ?? '', clip.id, 'clip');
}

const isEnabled = computed(() => workspaceStore.userSettings.experimentalFeatures === true);
</script>

<template>
  <g v-if="isEnabled" style="pointer-events: auto">
    <g v-for="item in bboxItems" :key="item.clip.id" :transform="item.transform">
      <template v-if="item.clip.clipType === 'text' && item.textBoxW !== undefined">
        <rect
          :x="item.textBoxX"
          :y="item.textBoxY"
          :width="item.textBoxW"
          :height="item.textBoxH"
          fill="rgba(255,255,255,0.03)"
          class="cursor-pointer"
          @pointerdown.stop="selectClip(item.clip)"
        />
      </template>
      <template v-else>
        <rect
          x="0"
          y="0"
          :width="item.targetW"
          :height="item.targetH"
          fill="rgba(255,255,255,0.03)"
          class="cursor-pointer"
          @pointerdown.stop="selectClip(item.clip)"
        />
      </template>
    </g>
  </g>
</template>
