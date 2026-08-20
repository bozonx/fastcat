<script setup lang="ts">
interface ClipPreviewOverlay {
  rangeStyle: Record<string, string>;
  direction: string;
  timecode: string;
  hasSourceRange: boolean;
  /**
   * Whether to draw the source-material line + end caps. False for images and
   * virtual clips, which have no finite source — only the offset timecode shows.
   */
  showSourceRange: boolean;
}

interface SlipOverlayView extends ClipPreviewOverlay {
  deltaClass: string;
}

defineProps<{
  slipOverlay: SlipOverlayView | null;
  trimOverlay: ClipPreviewOverlay | null;
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="slipOverlay"
    class="absolute inset-0 rounded bg-cyan-950/35 ring-1 ring-cyan-300/70 pointer-events-none overflow-hidden"
    :style="{ zIndex: 'var(--z-clip-guide)' }"
    :title="t('fastcat.timeline.slipMode')"
    data-slip-overlay
  >
    <div
      v-if="slipOverlay.showSourceRange"
      class="absolute inset-x-1.5 top-1 h-1.5 rounded-full bg-black/45 ring-1 ring-white/15"
    >
      <div
        v-if="slipOverlay.hasSourceRange"
        class="absolute top-0 bottom-0 min-w-2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.75)]"
        :style="slipOverlay.rangeStyle"
        data-slip-source-range
      />
      <div v-else class="absolute inset-0 rounded-full bg-cyan-300/85" />
    </div>
    <div
      class="absolute left-1/2 top-1/2 flex max-w-[calc(100%-8px)] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border border-cyan-200/35 bg-black/85 px-2 py-1 text-2xs font-semibold tabular-nums text-white shadow-lg whitespace-nowrap"
      :class="slipOverlay.deltaClass"
      data-slip-timecode
    >
      <span v-if="slipOverlay.direction" class="text-cyan-300">{{ slipOverlay.direction }}</span>
      <span>{{ slipOverlay.timecode }}</span>
    </div>
    <div
      v-if="slipOverlay.showSourceRange"
      class="absolute inset-x-1.5 bottom-1 flex justify-between"
    >
      <span class="h-2 w-px rounded-full bg-cyan-200/80" />
      <span class="h-2 w-px rounded-full bg-cyan-200/80" />
    </div>
  </div>

  <div
    v-if="trimOverlay"
    class="absolute inset-0 rounded bg-amber-950/35 ring-1 ring-amber-300/70 pointer-events-none overflow-hidden"
    :style="{ zIndex: 'var(--z-clip-guide)' }"
    :title="t('fastcat.timeline.trimOverlayMode')"
    data-trim-overlay
  >
    <div
      v-if="trimOverlay.showSourceRange"
      class="absolute inset-x-1.5 top-1 h-1.5 rounded-full bg-black/45 ring-1 ring-white/15"
    >
      <div
        v-if="trimOverlay.hasSourceRange"
        class="absolute top-0 bottom-0 min-w-2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.75)]"
        :style="trimOverlay.rangeStyle"
        data-trim-source-range
      />
      <div v-else class="absolute inset-0 rounded-full bg-amber-300/85" />
    </div>
    <div
      class="absolute left-1/2 top-1/2 flex max-w-[calc(100%-8px)] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border border-amber-200/35 bg-black/85 px-2 py-1 text-2xs font-semibold tabular-nums text-white shadow-lg whitespace-nowrap"
      data-trim-timecode
    >
      <span v-if="trimOverlay.direction" class="text-amber-300">{{ trimOverlay.direction }}</span>
      <span>{{ trimOverlay.timecode }}</span>
    </div>
    <div
      v-if="trimOverlay.showSourceRange"
      class="absolute inset-x-1.5 bottom-1 flex justify-between"
    >
      <span class="h-2 w-px rounded-full bg-amber-200/80" />
      <span class="h-2 w-px rounded-full bg-amber-200/80" />
    </div>
  </div>
</template>
