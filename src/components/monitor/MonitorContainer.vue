<script setup lang="ts">
import { computed } from 'vue';
import { useFocusStore } from '~/stores/focus.store';
import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { useMonitorRuntime } from '~/composables/monitor/useMonitorRuntime';
import MonitorAudioControl from './MonitorAudioControl.vue';
import MonitorTextTransformBox from './MonitorTextTransformBox.vue';
import MonitorViewport from './MonitorViewport.vue';
import MonitorTransformBox from './MonitorTransformBox.vue';

const { t } = useI18n();
const focusStore = useFocusStore();
const {
  projectStore,
  timelineStore,
  selectionStore,
  videoItems,
  safeDurationUs,
  isTextClipSelected,
  containerEl,
  renderWidth,
  renderHeight,
  viewportRef,
  isLoading,
  loadError,
  previewEffectsEnabled,
  scheduleBuild,
  useProxyInMonitor,
  isSavingStopFrame,
  createStopFrameSnapshot,
  timecodeEl,
} = useMonitorRuntime();

const { showGrid, toggleGrid, getGridLines } = useMonitorGrid({ projectStore });

const {
  canInteractPlayback,
  centerMonitor,
  contextMenuItems,
  createMarkerAtPlayhead,
  handleSpeedWheel,
  onPlaybackSpeedChange,
  playbackSpeedOptions,
  previewResolutions,
  resetZoom,
  rewindToStart,
  selectedPlaybackSpeedOption,
  setPlayback,
  togglePlayback,
  togglePreviewEffects,
  toggleProxyUsage,
  toolbarPosition,
} = useMonitorContainerControls({
  t,
  projectStore,
  timelineStore,
  selectionStore,
  viewportRef,
  videoItems,
  isLoading,
  loadError,
  safeDurationUs,
  previewEffectsEnabled,
  useProxyInMonitor,
  showGrid,
  isSavingStopFrame,
  createStopFrameSnapshot,
  scheduleBuild,
  toggleGrid,
});

const isReadonly = computed(
  () => projectStore.currentView === 'sound' || projectStore.currentView === 'export',
);

const monitorZoomLabel = computed(() => viewportRef.value?.zoomLabel ?? 'x1');

const props = withDefaults(
  defineProps<{
    isFullscreen?: boolean;
    useExternalFocus?: boolean;
  }>(),
  {
    isFullscreen: false,
    useExternalFocus: false,
  },
);

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
}>();
</script>

<template>
  <UContextMenu :items="contextMenuItems" class="h-full group/monitor">
    <div
      class="panel-focus-frame flex h-full min-w-0 min-h-0 transition-colors duration-300 relative"
      :class="[
        isFullscreen ? 'bg-black flex-col' : 'bg-ui-bg-elevated',
        !isFullscreen && toolbarPosition === 'bottom' ? 'flex-col' : '',
        !isFullscreen && toolbarPosition === 'top' ? 'flex-col-reverse' : '',
        !isFullscreen && toolbarPosition === 'right' ? 'flex-row' : '',
        !isFullscreen && toolbarPosition === 'left' ? 'flex-row-reverse' : '',
        {
          'panel-focus-frame--active':
            !props.useExternalFocus && !isFullscreen && focusStore.isPanelFocused('monitor'),
          'border-r border-ui-border': !isFullscreen,
        },
      ]"
      @pointerdown.capture="!props.useExternalFocus && focusStore.setMainFocus('monitor')"
    >
      <!-- Video area: MonitorViewport handles pan/zoom/gestures -->
      <MonitorViewport ref="viewportRef" :render-width="renderWidth" :render-height="renderHeight">
        <!-- WebGL/canvas container mounted at canvas resolution -->
        <template #canvas>
          <div ref="containerEl" class="absolute inset-0" style="pointer-events: none" />
        </template>

        <!-- 3x3 guide grid SVG overlay, synced with viewport transform -->
        <template #svg-overlay>
          <g v-if="showGrid">
            <line
              v-for="(line, i) in getGridLines(renderWidth, renderHeight)"
              :key="i"
              :x1="line.x1"
              :y1="line.y1"
              :x2="line.x2"
              :y2="line.y2"
              stroke="rgba(255,255,255,0.5)"
              stroke-width="1"
            />
          </g>

          <MonitorTextTransformBox
            v-if="!isReadonly && isTextClipSelected"
            :render-width="renderWidth"
            :render-height="renderHeight"
          />

          <MonitorTransformBox
            v-else-if="!isReadonly"
            :render-width="renderWidth"
            :render-height="renderHeight"
          />
        </template>

        <!-- Absolute overlays: empty state, loading, error, timecode -->
        <template #default>
          <div
            v-if="loadError"
            class="absolute inset-0 flex items-center justify-center text-red-500"
          >
            {{ loadError }}
          </div>

          <span
            ref="timecodeEl"
            class="absolute text-xs text-ui-text-muted font-mono tabular-nums bg-ui-bg-elevated/80 px-2 py-1 rounded transition-all duration-300"
            :class="[
              isFullscreen
                ? 'bottom-24 right-8 opacity-0 group-hover/monitor:opacity-100 translate-y-2 group-hover/monitor:translate-y-0'
                : 'bottom-3 right-3',
            ]"
          >
            00:00:00:00 / 00:00:00:00
          </span>
        </template>
      </MonitorViewport>

      <!-- Playback controls -->
      <div
        class="flex flex-wrap items-center justify-center gap-3 border-ui-border shrink-0 transition-all duration-300 select-none"
        :class="[
          isFullscreen
            ? 'absolute bottom-8 left-1/2 -translate-x-1/2 bg-ui-bg-elevated/80 backdrop-blur-xl px-6 py-3 rounded-2xl shadow-2xl z-50 border-none opacity-0 group-hover/monitor:opacity-100 hover:opacity-100! translate-y-4 group-hover/monitor:translate-y-0'
            : 'px-4 py-3.5 bg-ui-bg-elevated cursor-grab active:cursor-grabbing',
          !isFullscreen && toolbarPosition === 'bottom' ? 'border-t' : '',
          !isFullscreen && toolbarPosition === 'top' ? 'border-b' : '',
          !isFullscreen && toolbarPosition === 'right' ? 'border-l' : '',
          !isFullscreen && toolbarPosition === 'left' ? 'border-r' : '',
          (toolbarPosition === 'left' || toolbarPosition === 'right') && !isFullscreen
            ? 'flex-col'
            : '',
        ]"
        :draggable="!isFullscreen"
        @dragstart="(e) => emit('panelDragStart', e)"
      >
        <div
          class="flex items-center gap-2 shrink-0"
          :class="toolbarPosition === 'left' || toolbarPosition === 'right' ? 'flex-col' : ''"
        >
          <UTooltip :text="t('fastcat.timeline.addMarkerAtPlayhead', 'Add marker at playhead')">
            <UButton
              size="2xs"
              color="neutral"
              variant="ghost"
              icon="i-heroicons-bookmark"
              @click="createMarkerAtPlayhead"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.center', 'Center')">
            <UButton
              size="2xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-crosshair"
              @click="centerMonitor"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.resetZoom', 'Reset zoom')">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              class="font-mono tabular-nums min-w-12 justify-center"
              :label="monitorZoomLabel"
              @click="resetZoom"
            />
          </UTooltip>

          <UTooltip :text="t('fastcat.monitor.useProxy', 'Use proxy')">
            <UButton
              v-if="projectStore.projectSettings.monitor"
              size="xs"
              :color="useProxyInMonitor ? 'primary' : 'neutral'"
              :variant="useProxyInMonitor ? 'soft' : 'ghost'"
              icon="i-heroicons-bolt"
              @click="toggleProxyUsage"
            />
          </UTooltip>

          <UTooltip
            :text="
              previewEffectsEnabled
                ? t('fastcat.monitor.previewWithEffects', 'Preview with effects')
                : t('fastcat.monitor.previewWithoutEffects', 'Preview without effects')
            "
          >
            <UButton
              v-if="projectStore.projectSettings.monitor"
              size="xs"
              :color="previewEffectsEnabled ? 'primary' : 'neutral'"
              :variant="previewEffectsEnabled ? 'soft' : 'ghost'"
              :label="
                previewEffectsEnabled
                  ? t('fastcat.monitor.withEffects', 'With effects')
                  : t('fastcat.monitor.withoutEffects', 'Without effects')
              "
              @click="togglePreviewEffects"
            />
          </UTooltip>

          <div class="w-17">
            <USelectMenu
              v-if="projectStore.projectSettings.monitor"
              :model-value="
                (previewResolutions.find(
                  (r) => r.value === projectStore.projectSettings.monitor.previewResolution,
                ) || previewResolutions[2]) as any
              "
              :items="previewResolutions"
              value-key="value"
              label-key="label"
              size="2xs"
              :search-input="false"
              :ui="{ trigger: 'px-1 py-1 font-medium' }"
              class="w-full"
              @update:model-value="
                (v: any) => {
                  if (v) projectStore.projectSettings.monitor.previewResolution = v.value ?? v;
                }
              "
            >
              <template #leading="{ modelValue }">
                <UIcon
                  v-if="(modelValue as any)?.isProject"
                  name="i-heroicons-star-20-solid"
                  class="w-3 h-3 text-primary-500 shrink-0"
                  :title="t('fastcat.monitor.projectResolutionHint')"
                />
                <span v-else class="w-3 h-3 shrink-0"></span>
              </template>
              <template #item-label="{ item }">
                <span
                  :class="[
                    item.value === projectStore.projectSettings.monitor?.previewResolution
                      ? 'text-primary-500 font-medium'
                      : '',
                    'truncate text-xs',
                  ]"
                >
                  {{ item.label }}
                </span>
              </template>
              <template #item-trailing="{ item }">
                <UIcon
                  v-if="
                    item.isProject &&
                    item.value !== projectStore.projectSettings.monitor?.previewResolution
                  "
                  name="i-heroicons-star-20-solid"
                  class="w-3 h-3 text-primary-500 shrink-0"
                  :title="t('fastcat.monitor.projectResolutionHint')"
                />
              </template>
            </USelectMenu>
          </div>

          <UButton
            v-if="isFullscreen"
            size="sm"
            color="primary"
            variant="solid"
            icon="i-heroicons-arrow-left"
            :label="t('common.back', 'Back')"
            @click="projectStore.goToCut()"
          />

          <UButton
            v-else
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-heroicons-arrows-pointing-out"
            :title="t('fastcat.monitor.fullscreen', 'Fullscreen')"
            @click="projectStore.goToFullscreen()"
          />
        </div>

        <UButton
          size="md"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-uturn-left"
          :aria-label="t('fastcat.monitor.rewind', 'Rewind')"
          :disabled="!canInteractPlayback"
          @click="rewindToStart"
        />

        <UButton
          size="md"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-backward"
          :aria-label="t('fastcat.monitor.playBackward', 'Play backward')"
          :disabled="!canInteractPlayback"
          @click="
            setPlayback({ direction: 'backward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
          "
          @wheel.prevent="handleSpeedWheel"
        />

        <UButton
          size="md"
          variant="solid"
          color="primary"
          :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
          :aria-label="t('fastcat.monitor.play', 'Play')"
          :disabled="!canInteractPlayback"
          @click="
            setPlayback({ direction: 'forward', speed: selectedPlaybackSpeedOption?.value ?? 1 })
          "
          @wheel.prevent="handleSpeedWheel"
        />

        <div class="w-15">
          <USelectMenu
            :model-value="selectedPlaybackSpeedOption as any"
            :items="playbackSpeedOptions"
            value-key="value"
            label-key="label"
            size="2xs"
            :search-input="false"
            :ui="{ trigger: 'px-1 py-1 font-medium' }"
            class="w-full"
            :disabled="!canInteractPlayback"
            @update:model-value="onPlaybackSpeedChange"
            @wheel.prevent="handleSpeedWheel"
          >
            <template #item-label="{ item }">
              <span class="truncate text-xs">{{ item.label }}</span>
            </template>
          </USelectMenu>
        </div>

        <MonitorAudioControl :compact="toolbarPosition === 'left' || toolbarPosition === 'right'" />
      </div>
    </div>
  </UContextMenu>
</template>
