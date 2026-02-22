<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useProjectStore } from '~/stores/project.store'
import { useTimelineStore } from '~/stores/timeline.store'
import { getPreviewWorkerClient, setPreviewHostApi } from '~/utils/video-editor/worker-client'
import { clampTimeUs, normalizeTimeUs, sanitizeFps } from '~/utils/monitor-time'
import type { TimelineTrack, TimelineTrackItem } from '~/timeline/types'

interface WorkerTimelineClip {
  kind: 'clip'
  id: string
  source: {
    path: string
  }
  timelineRange: {
    startUs: number
    durationUs: number
  }
  sourceRange: {
    startUs: number
    durationUs: number
  }
}

async function flushBuildQueue() {
  if (buildInFlight) {
    return
  }

  buildInFlight = true
  try {
    while (buildRequested && !isUnmounted) {
      buildRequested = false
      await buildTimeline()
    }
  } finally {
    buildInFlight = false
  }
}

function scheduleLayoutUpdate(layoutClips: WorkerTimelineClip[]) {
  pendingLayoutClips = layoutClips
  if (layoutDebounceTimer !== null) {
    clearTimeout(layoutDebounceTimer)
  }
  layoutDebounceTimer = window.setTimeout(() => {
    layoutDebounceTimer = null
    void flushLayoutUpdateQueue()
  }, LAYOUT_DEBOUNCE_MS)
}

async function flushLayoutUpdateQueue() {
  if (layoutUpdateInFlight || isUnmounted) {
    return
  }

  layoutUpdateInFlight = true
  try {
    while (pendingLayoutClips) {
      const layoutClips = pendingLayoutClips
      pendingLayoutClips = null
      try {
        const maxDuration = await client.updateTimelineLayout(layoutClips)
        timelineStore.duration = maxDuration
        lastBuiltLayoutSignature = clipLayoutSignature.value
        scheduleRender(localCurrentTimeUs)
      } catch (error) {
        console.error('[Monitor] Failed to update timeline layout', error)
      }
    }
  } finally {
    layoutUpdateInFlight = false
  }
}

const { t } = useI18n()
const projectStore = useProjectStore()
const timelineStore = useTimelineStore()

const videoTrack = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find((track: TimelineTrack) => track.kind === 'video') ?? null)
const videoItems = computed(() => (videoTrack.value?.items ?? []).filter((it: TimelineTrackItem) => it.kind === 'clip'))
const workerTimelineClips = computed(() => toWorkerTimelineClips(videoItems.value))
const safeDurationUs = computed(() => normalizeTimeUs(timelineStore.duration))
const canInteractPlayback = computed(
  () => videoItems.value.length > 0 && !isLoading.value && !loadError.value,
)

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mixHash(hash: number, value: number): number {
  hash ^= value
  hash = Math.imul(hash, 16777619)
  return hash >>> 0
}

function mixTime(hash: number, value: number): number {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0
  const low = safeValue >>> 0
  const high = Math.floor(safeValue / 0x1_0000_0000) >>> 0
  return mixHash(mixHash(hash, low), high)
}

const clipSourceSignature = computed(() => {
  let hash = mixHash(2166136261, videoItems.value.length)
  for (const item of videoItems.value) {
    hash = mixHash(hash, hashString(item.id))
    if (item.kind === 'clip') {
      hash = mixHash(hash, hashString(item.source.path))
    }
  }
  return hash
})

const clipLayoutSignature = computed(() => {
  let hash = mixHash(2166136261, videoItems.value.length)
  for (const item of videoItems.value) {
    hash = mixHash(hash, hashString(item.id))
    hash = mixTime(hash, item.timelineRange.startUs)
    hash = mixTime(hash, item.timelineRange.durationUs)
    if (item.kind === 'clip') {
      hash = mixTime(hash, item.sourceRange.startUs)
      hash = mixTime(hash, item.sourceRange.durationUs)
    }
  }
  return hash
})

const containerEl = ref<HTMLDivElement | null>(null)
const viewportEl = ref<HTMLDivElement | null>(null)
const loadError = ref<string | null>(null)
const isLoading = ref(false)

const MIN_CANVAS_DIMENSION = 16
const MAX_CANVAS_DIMENSION = 7680

const exportWidth = computed(() => {
  const value = Number(projectStore.projectSettings.export.width)
  if (!Number.isFinite(value) || value <= 0) return 1920
  return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)))
})

const exportHeight = computed(() => {
  const value = Number(projectStore.projectSettings.export.height)
  if (!Number.isFinite(value) || value <= 0) return 1080
  return Math.round(Math.min(MAX_CANVAS_DIMENSION, Math.max(MIN_CANVAS_DIMENSION, value)))
})

const aspectRatio = computed(() => {
  const width = exportWidth.value
  const height = exportHeight.value
  if (width <= 0 || height <= 0) return 16 / 9
  return width / height
})

const canvasDisplaySize = ref({ width: 0, height: 0 })

const canvasScale = computed(() => {
  const dw = canvasDisplaySize.value.width
  const dh = canvasDisplaySize.value.height
  if (!dw || !dh || !exportWidth.value || !exportHeight.value) return 1
  return Math.min(dw / exportWidth.value, dh / exportHeight.value)
})

function getCanvasWrapperStyle() {
  return {
    width: `${canvasDisplaySize.value.width}px`,
    height: `${canvasDisplaySize.value.height}px`,
    overflow: 'hidden',
  }
}

function toWorkerTimelineClips(items: TimelineTrackItem[]): WorkerTimelineClip[] {
  const clips: WorkerTimelineClip[] = []
  for (const item of items) {
    if (item.kind !== 'clip') continue
    clips.push({
      kind: 'clip',
      id: item.id,
      source: {
        path: item.source.path,
      },
      timelineRange: {
        startUs: item.timelineRange.startUs,
        durationUs: item.timelineRange.durationUs,
      },
      sourceRange: {
        startUs: item.sourceRange.startUs,
        durationUs: item.sourceRange.durationUs,
      },
    })
  }
  return clips
}

const BUILD_DEBOUNCE_MS = 120
const LAYOUT_DEBOUNCE_MS = 50
const STORE_TIME_SYNC_MS = 100

function scheduleBuild() {
  if (buildDebounceTimer !== null) {
    clearTimeout(buildDebounceTimer)
  }
  buildDebounceTimer = window.setTimeout(() => {
    buildDebounceTimer = null
    buildRequested = true
    void flushBuildQueue()
  }, BUILD_DEBOUNCE_MS)
}

function getCanvasInnerStyle() {
  return {
    width: `${exportWidth.value}px`,
    height: `${exportHeight.value}px`,
    transform: `scale(${canvasScale.value})`,
    transformOrigin: 'top left',
  }
}

let viewportResizeObserver: ResizeObserver | null = null
let buildRequestId = 0
let lastBuiltSourceSignature = 0
let lastBuiltLayoutSignature = 0
let canvasEl: HTMLCanvasElement | null = null
let compositorReady = false
let compositorWidth = 0
let compositorHeight = 0
let buildInFlight = false
let buildRequested = false
let buildDebounceTimer: number | null = null
let layoutDebounceTimer: number | null = null
let layoutUpdateInFlight = false
let pendingLayoutClips: WorkerTimelineClip[] | null = null
let renderLoopInFlight = false
let latestRenderTimeUs: number | null = null
let isUnmounted = false
let suppressStoreSeekWatch = false

const { client } = getPreviewWorkerClient()

function scheduleRender(timeUs: number) {
  if (isUnmounted) return
  latestRenderTimeUs = normalizeTimeUs(timeUs)
  if (renderLoopInFlight) return

  renderLoopInFlight = true
  const run = async () => {
    try {
      while (latestRenderTimeUs !== null) {
        if (isUnmounted) {
          latestRenderTimeUs = null
          break
        }
        const nextTimeUs = latestRenderTimeUs
        latestRenderTimeUs = null
        await client.renderFrame(nextTimeUs)
      }
    } catch (err) {
      console.error('[Monitor] Render failed', err)
    } finally {
      renderLoopInFlight = false
      if (latestRenderTimeUs !== null) {
        scheduleRender(latestRenderTimeUs)
      }
    }
  }

  void run()
}

function updateStoreTime(timeUs: number) {
  const normalizedTimeUs = clampToTimeline(timeUs)
  if (timelineStore.currentTime === normalizedTimeUs) {
    return
  }
  suppressStoreSeekWatch = true
  timelineStore.currentTime = normalizedTimeUs
  suppressStoreSeekWatch = false
}

function clampToTimeline(timeUs: number): number {
  return clampTimeUs(timeUs, safeDurationUs.value)
}

async function ensureCompositorReady(options?: { forceRecreate?: boolean }) {
  if (!containerEl.value) {
    return
  }

  const shouldRecreate = options?.forceRecreate ?? false
  const targetWidth = exportWidth.value
  const targetHeight = exportHeight.value
  const needReinit =
    !compositorReady ||
    compositorWidth !== targetWidth ||
    compositorHeight !== targetHeight ||
    shouldRecreate

  if (!needReinit) {
    return
  }

  if (shouldRecreate || !canvasEl || needReinit) {
    containerEl.value.innerHTML = ''
    canvasEl = document.createElement('canvas')
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    canvasEl.style.display = 'block'
    containerEl.value.appendChild(canvasEl)
    compositorReady = false
  }

  if (!canvasEl) {
    return
  }

  canvasEl.width = targetWidth
  canvasEl.height = targetHeight
  const offscreen = canvasEl.transferControlToOffscreen()
  await client.destroyCompositor()
  await client.initCompositor(offscreen, targetWidth, targetHeight, '#000')
  compositorReady = true
  compositorWidth = targetWidth
  compositorHeight = targetHeight
}

function updateCanvasDisplaySize() {
  const viewport = viewportEl.value
  if (!viewport) return

  const availableWidth = viewport.clientWidth
  const availableHeight = viewport.clientHeight

  if (availableWidth <= 0 || availableHeight <= 0) {
    canvasDisplaySize.value = { width: 0, height: 0 }
    return
  }

  let width = availableWidth
  let height = Math.round(width / aspectRatio.value)

  if (height > availableHeight) {
    height = availableHeight
    width = Math.round(height * aspectRatio.value)
  }

  canvasDisplaySize.value = { width, height }
}


async function buildTimeline() {
  if (!containerEl.value) return
  const requestId = ++buildRequestId
  isLoading.value = true
  loadError.value = null

  try {
    await ensureCompositorReady()
    const clips = workerTimelineClips.value
    if (clips.length === 0) {
      await client.clearClips()
      timelineStore.duration = 0
      localCurrentTimeUs = 0
      uiCurrentTimeUs.value = 0
      updateStoreTime(0)
      isLoading.value = false
      return
    }

    setPreviewHostApi({
      getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
      onExportProgress: () => {},
    })

    const maxDuration = await client.loadTimeline(clips)

    lastBuiltSourceSignature = clipSourceSignature.value
    lastBuiltLayoutSignature = clipLayoutSignature.value

    timelineStore.duration = normalizeTimeUs(maxDuration)

    localCurrentTimeUs = 0
    uiCurrentTimeUs.value = 0
    updateStoreTime(0)
    timelineStore.isPlaying = false
    scheduleRender(0)

  } catch (e: any) {
    console.error('Failed to build timeline components', e)
    if (requestId === buildRequestId) {
      loadError.value = e.message || t('granVideoEditor.monitor.loadError', 'Error loading timeline')
    }
  } finally {
    if (requestId === buildRequestId) {
      isLoading.value = false
    }
  }
}

watch(clipSourceSignature, () => {
  scheduleBuild()
})

watch(clipLayoutSignature, () => {
  if (isLoading.value || !compositorReady) {
    return
  }
  if (clipSourceSignature.value !== lastBuiltSourceSignature) {
    return
  }
  if (clipLayoutSignature.value === lastBuiltLayoutSignature) {
    return
  }

  const layoutClips = workerTimelineClips.value
  scheduleLayoutUpdate(layoutClips)
})

watch(
  () => [projectStore.projectSettings.export.width, projectStore.projectSettings.export.height],
  () => {
    updateCanvasDisplaySize()
    compositorReady = false
    scheduleBuild()
  },
)

// Playback loop state
let playbackLoopId = 0
let lastFrameTimeMs = 0
let localCurrentTimeUs = 0
const uiCurrentTimeUs = ref(0)
let renderAccumulatorMs = 0
let storeSyncAccumulatorMs = 0

function updatePlayback(timestamp: number) {
  if (!timelineStore.isPlaying) return

  const deltaMsRaw = timestamp - lastFrameTimeMs
  const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0
  lastFrameTimeMs = timestamp
  renderAccumulatorMs += deltaMs
  storeSyncAccumulatorMs += deltaMs

  let newTimeUs = clampToTimeline(localCurrentTimeUs + deltaMs * 1000)
  if (newTimeUs >= safeDurationUs.value) {
    newTimeUs = safeDurationUs.value
    timelineStore.isPlaying = false
    localCurrentTimeUs = newTimeUs
    uiCurrentTimeUs.value = newTimeUs
    updateStoreTime(newTimeUs)
    scheduleRender(newTimeUs)
    return
  }

  localCurrentTimeUs = newTimeUs
  uiCurrentTimeUs.value = newTimeUs

  if (storeSyncAccumulatorMs >= STORE_TIME_SYNC_MS) {
    storeSyncAccumulatorMs = 0
    updateStoreTime(newTimeUs)
  }

  const fps = sanitizeFps(projectStore.projectSettings?.export?.fps)
  const frameIntervalMs = 1000 / fps

  if (renderAccumulatorMs >= frameIntervalMs) {
    renderAccumulatorMs %= frameIntervalMs
    scheduleRender(newTimeUs)
  }

  if (timelineStore.isPlaying) {
    playbackLoopId = requestAnimationFrame(updatePlayback)
  }
}

watch(() => timelineStore.isPlaying, (playing) => {
  if (isLoading.value || loadError.value) {
    if (playing) timelineStore.isPlaying = false
    return
  }

  if (playing) {
    if (localCurrentTimeUs >= safeDurationUs.value) {
      localCurrentTimeUs = 0
      uiCurrentTimeUs.value = 0
      updateStoreTime(0)
    }
    localCurrentTimeUs = clampToTimeline(timelineStore.currentTime)
    uiCurrentTimeUs.value = localCurrentTimeUs
    lastFrameTimeMs = performance.now()
    renderAccumulatorMs = 0
    storeSyncAccumulatorMs = 0
    playbackLoopId = requestAnimationFrame(updatePlayback)
  } else {
    cancelAnimationFrame(playbackLoopId)
    updateStoreTime(clampToTimeline(localCurrentTimeUs))
  }
})

// Sync time to store (initial seek or external seek)
watch(() => timelineStore.currentTime, (val) => {
  if (suppressStoreSeekWatch) {
    return
  }
  const normalizedTimeUs = clampToTimeline(val)
  if (normalizedTimeUs !== val) {
    updateStoreTime(normalizedTimeUs)
    return
  }
  if (!timelineStore.isPlaying) {
    localCurrentTimeUs = normalizedTimeUs
    uiCurrentTimeUs.value = normalizedTimeUs
    scheduleRender(normalizedTimeUs)
  }
})

onMounted(() => {
  isUnmounted = false
  localCurrentTimeUs = clampToTimeline(timelineStore.currentTime)
  uiCurrentTimeUs.value = localCurrentTimeUs
  updateCanvasDisplaySize()
  if (typeof ResizeObserver !== 'undefined' && viewportEl.value) {
    viewportResizeObserver = new ResizeObserver(() => {
      updateCanvasDisplaySize()
    })
    viewportResizeObserver.observe(viewportEl.value)
  }
  scheduleBuild()
})

onBeforeUnmount(() => {
  isUnmounted = true
  timelineStore.isPlaying = false
  latestRenderTimeUs = null
  if (buildDebounceTimer !== null) {
    clearTimeout(buildDebounceTimer)
    buildDebounceTimer = null
  }
  if (layoutDebounceTimer !== null) {
    clearTimeout(layoutDebounceTimer)
    layoutDebounceTimer = null
  }
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null
  cancelAnimationFrame(playbackLoopId)
  pendingLayoutClips = null
  void client.destroyCompositor().catch(error => {
    console.error('[Monitor] Failed to destroy compositor on unmount', error)
  })
})

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-950">
    <!-- Header -->
    <div class="flex items-center px-3 py-2 border-b border-gray-700 shrink-0">
      <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {{ t('granVideoEditor.monitor.title', 'Monitor') }}
      </span>
    </div>

    <!-- Video area -->
    <div ref="viewportEl" class="flex-1 flex items-center justify-center overflow-hidden relative">
      <div v-if="videoItems.length === 0" class="flex flex-col items-center gap-3 text-gray-700">
        <UIcon name="i-heroicons-play-circle" class="w-16 h-16" />
        <p class="text-sm">
          {{ t('granVideoEditor.monitor.empty', 'No clip selected') }}
        </p>
      </div>
      <div v-else-if="isLoading" class="absolute inset-0 flex items-center justify-center text-gray-400">
        <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
      </div>
      <div v-else-if="loadError" class="absolute inset-0 flex items-center justify-center text-red-500">
        {{ loadError }}
      </div>
      
      <div
        class="shrink-0"
        :style="getCanvasWrapperStyle()"
        :class="{ invisible: loadError || videoItems.length === 0 }"
      >
        <div ref="containerEl" :style="getCanvasInnerStyle()" />
      </div>
    </div>

    <!-- Playback controls -->
    <div class="flex items-center justify-center gap-3 px-4 py-3 border-t border-gray-700 shrink-0">
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-backward"
        :aria-label="t('granVideoEditor.monitor.rewind', 'Rewind')"
        :disabled="!canInteractPlayback"
        @click="timelineStore.currentTime = 0"
      />
      <UButton
        size="sm"
        variant="solid"
        color="primary"
        :icon="timelineStore.isPlaying ? 'i-heroicons-pause' : 'i-heroicons-play'"
        :aria-label="t('granVideoEditor.monitor.play', 'Play')"
        :disabled="!canInteractPlayback"
        @click="timelineStore.isPlaying = !timelineStore.isPlaying"
      />
      <span class="text-xs text-gray-600 ml-2 font-mono">
        {{ formatTime(uiCurrentTimeUs / 1e6) }} / {{ formatTime(timelineStore.duration / 1e6) }}
      </span>
    </div>
  </div>
</template>
