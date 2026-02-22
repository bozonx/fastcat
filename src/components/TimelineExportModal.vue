<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '~/stores/workspace.store'
import { useProjectStore } from '~/stores/project.store'
import { useTimelineStore } from '~/stores/timeline.store'
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client'
import type { TimelineTrackItem } from '~/timeline/types'
import MediaEncodingSettings, { type FormatOption } from '~/components/media/MediaEncodingSettings.vue'
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkAudioCodecSupport,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs'

interface Props {
  open: boolean
}

interface ExportOptions {
  format: 'mp4' | 'webm' | 'mkv'
  videoCodec: string
  bitrate: number
  audioBitrate: number
  audio: boolean
  audioCodec?: string
  width: number
  height: number
  fps: number
}

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

const EXPORT_FRAME_YIELD_INTERVAL = 12

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  exported: []
}>()

const { t } = useI18n()
const toast = useToast()
const workspaceStore = useWorkspaceStore()
const projectStore = useProjectStore()
const timelineStore = useTimelineStore()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const outputFilename = ref('')
const filenameError = ref<string | null>(null)

const outputFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4')
const videoCodec = ref('avc1.42E032')
const bitrateMbps = ref<number>(5)
const excludeAudio = ref(false)
const audioCodec = ref('aac')
const audioBitrateKbps = ref<number>(128)
const exportWidth = ref<number>(1920)
const exportHeight = ref<number>(1080)
const exportFps = ref<number>(30)

const isExporting = ref(false)
const exportProgress = ref(0)
const exportError = ref<string | null>(null)
const exportPhase = ref<'encoding' | 'saving' | null>(null)

function getFormatOptions(): readonly FormatOption[] {
  return [
    { value: 'mp4', label: 'MP4' },
    { value: 'webm', label: 'WebM (VP9 + Opus)' },
    { value: 'mkv', label: 'MKV (AV1 + Opus)' },
  ]
}

const videoCodecSupport = ref<Record<string, boolean>>({})
const isLoadingCodecSupport = ref(false)

function getVideoCodecOptions() {
  return resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value)
}

function getAudioCodecLabel() {
  if (outputFormat.value === 'webm' || outputFormat.value === 'mkv') return 'Opus'
  return audioCodec.value === 'opus' ? 'Opus' : 'AAC'
}

const bitrateBps = computed(() => {
  const value = Number(bitrateMbps.value)
  if (!Number.isFinite(value)) return 5_000_000
  const clamped = Math.min(200, Math.max(0.2, value))
  return Math.round(clamped * 1_000_000)
})

const normalizedExportWidth = computed(() => {
  const value = Number(exportWidth.value)
  if (!Number.isFinite(value) || value <= 0) return 1920
  return Math.round(value)
})

const normalizedExportHeight = computed(() => {
  const value = Number(exportHeight.value)
  if (!Number.isFinite(value) || value <= 0) return 1080
  return Math.round(value)
})

const normalizedExportFps = computed(() => {
  const value = Number(exportFps.value)
  if (!Number.isFinite(value) || value <= 0) return 30
  return Math.round(Math.min(240, Math.max(1, value)))
})

function getPhaseLabel() {
  if (exportPhase.value === 'encoding') return t('videoEditor.export.phaseEncoding', 'Encoding')
  if (exportPhase.value === 'saving') return t('videoEditor.export.phaseSaving', 'Saving')
  return ''
}

const ext = computed(() => getExt(outputFormat.value))

function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function listExportFilenames(exportDir: FileSystemDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>()
  const iterator = (exportDir as any).values?.() ?? (exportDir as any).entries?.()
  if (!iterator) return names

  for await (const value of iterator) {
    const handle = Array.isArray(value) ? value[1] : value
    if (handle?.kind === 'file' && typeof handle?.name === 'string') {
      names.add(handle.name)
    }
  }
  return names
}

function getExt(fmt: 'mp4' | 'webm' | 'mkv'): 'mp4' | 'webm' | 'mkv' {
  if (fmt === 'webm') return 'webm'
  if (fmt === 'mkv') return 'mkv'
  return 'mp4'
}

async function getNextAvailableFilename(exportDir: FileSystemDirectoryHandle, base: string, ext: string) {
  const names = await listExportFilenames(exportDir)
  let index = 1
  while (index < 1000) {
    const candidate = `${base}_${String(index).padStart(3, '0')}.${ext}`
    if (!names.has(candidate)) return candidate
    index++
  }
  throw new Error('Failed to generate a unique filename')
}

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return
  isLoadingCodecSupport.value = true
  try {
    const [videoSupport, audioSupport] = await Promise.all([
      checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS),
      checkAudioCodecSupport([
        { value: 'mp4a.40.2', label: 'AAC' },
        { value: 'opus', label: 'Opus' },
      ]),
    ])

    videoCodecSupport.value = videoSupport

    if (videoCodecSupport.value[videoCodec.value] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find((opt) => videoCodecSupport.value[opt.value])
      if (firstSupported) videoCodec.value = firstSupported.value
    }

    if (audioSupport['mp4a.40.2'] === false && audioSupport['opus'] !== false) {
      audioCodec.value = 'opus'
    } else {
      audioCodec.value = 'aac'
    }
  } finally {
    isLoadingCodecSupport.value = false
  }
}

function getBunnyVideoCodec(codec: string): any {
  if (codec.startsWith('avc1')) return 'avc'
  if (codec.startsWith('hvc1') || codec.startsWith('hev1')) return 'hevc'
  if (codec.startsWith('vp8')) return 'vp8'
  if (codec.startsWith('vp09')) return 'vp9'
  if (codec.startsWith('av01')) return 'av1'
  return 'avc'
}

function resolveExportCodecs(format: 'mp4' | 'webm' | 'mkv', selectedVideoCodec: string, selectedAudioCodec: string) {
  if (format === 'webm') {
    return {
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus',
    }
  }

  if (format === 'mkv') {
    return {
      videoCodec: 'av01.0.05M.08',
      audioCodec: 'opus',
    }
  }

  return {
    videoCodec: selectedVideoCodec,
    audioCodec: selectedAudioCodec,
  }
}

async function exportTimelineToFile(options: ExportOptions, fileHandle: FileSystemFileHandle, onProgress: (progress: number) => void): Promise<void> {
  const doc = timelineStore.timelineDoc
  const track = doc?.tracks?.find(track => track.kind === 'video')
  const clips = toWorkerTimelineClips(track?.items ?? [])
  if (!clips.length) throw new Error('Timeline is empty')

  const { client } = getExportWorkerClient();

  setExportHostApi({
    getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
    onExportProgress: (progress) => onProgress(progress),
  });

  await client.exportTimeline(fileHandle, options, clips);
}

async function ensureExportDir(): Promise<FileSystemDirectoryHandle> {
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
    throw new Error('Project is not opened')
  }
  const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName)
  return await projectDir.getDirectoryHandle('export', { create: true })
}

async function validateFilename(exportDir: FileSystemDirectoryHandle) {
  const trimmed = outputFilename.value.trim()
  if (!trimmed) {
    filenameError.value = 'Filename is required'
    return false
  }

  if (!trimmed.toLowerCase().endsWith(`.${ext.value}`)) {
    filenameError.value = `Filename must end with .${ext.value}`
    return false
  }

  const names = await listExportFilenames(exportDir)
  if (names.has(trimmed)) {
    filenameError.value = 'A file with this name already exists'
    return false
  }

  filenameError.value = null
  return true
}

watch(
  () => props.open,
  async (val) => {
    if (!val) return

    exportError.value = null
    filenameError.value = null
    exportProgress.value = 0
    exportPhase.value = null
    isExporting.value = false

    outputFormat.value = 'mp4'
    videoCodec.value = projectStore.projectSettings.export.encoding.videoCodec
    bitrateMbps.value = projectStore.projectSettings.export.encoding.bitrateMbps
    excludeAudio.value = projectStore.projectSettings.export.encoding.excludeAudio
    audioBitrateKbps.value = projectStore.projectSettings.export.encoding.audioBitrateKbps
    exportWidth.value = projectStore.projectSettings.export.width
    exportHeight.value = projectStore.projectSettings.export.height
    exportFps.value = projectStore.projectSettings.export.fps

    await loadCodecSupport()

    outputFormat.value = projectStore.projectSettings.export.encoding.format

    const exportDir = await ensureExportDir()
    const timelineBase = sanitizeBaseName(projectStore.currentFileName || projectStore.currentProjectName || 'timeline')
    outputFilename.value = await getNextAvailableFilename(exportDir, timelineBase, getExt(outputFormat.value))
    await validateFilename(exportDir)
  },
)

watch(outputFormat, async (fmt) => {
  const codecConfig = resolveExportCodecs(fmt, videoCodec.value, audioCodec.value)
  videoCodec.value = codecConfig.videoCodec
  audioCodec.value = codecConfig.audioCodec

  if (!props.open) return

  try {
    const exportDir = await ensureExportDir()
    const base = outputFilename.value.replace(/\.[^.]+$/, '')
    const nextExt = getExt(fmt)

    if (!base) return

    if (!/_\d{3}$/.test(base)) {
      outputFilename.value = await getNextAvailableFilename(exportDir, base, nextExt)
      return
    }

    outputFilename.value = `${base}.${nextExt}`
    await validateFilename(exportDir)
  } catch {
    // ignore
  }
})

watch(outputFilename, async () => {
  if (!props.open) return
  try {
    const exportDir = await ensureExportDir()
    await validateFilename(exportDir)
  } catch {
    // ignore
  }
})

async function handleConfirm() {
  if (isExporting.value) return

  isExporting.value = true
  exportProgress.value = 0
  exportError.value = null

  try {
    const exportDir = await ensureExportDir()
    const ok = await validateFilename(exportDir)
    if (!ok) return

    // Disallow overwriting an existing file
    try {
      await exportDir.getFileHandle(outputFilename.value)
      throw new Error('A file with this name already exists')
    } catch (e: any) {
      // Expected when file does not exist.
      if (e?.name !== 'NotFoundError') {
        throw e
      }
    }

    let fileHandle: FileSystemFileHandle
    try {
      fileHandle = await exportDir.getFileHandle(outputFilename.value, { create: true })
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'InvalidModificationError') {
        throw new Error('A file with this name already exists', { cause: e })
      }
      throw e
    }

    const resolvedCodecs = resolveExportCodecs(outputFormat.value, videoCodec.value, audioCodec.value)

    exportPhase.value = 'encoding'
    await exportTimelineToFile({
      format: outputFormat.value,
      videoCodec: resolvedCodecs.videoCodec,
      bitrate: bitrateBps.value,
      audioBitrate: audioBitrateKbps.value * 1000,
      audio: !excludeAudio.value,
      audioCodec: resolvedCodecs.audioCodec,
      width: normalizedExportWidth.value,
      height: normalizedExportHeight.value,
      fps: normalizedExportFps.value,
    }, fileHandle, (progress) => {
      exportProgress.value = progress
    })

    exportProgress.value = 100

    toast.add({
      title: t('common.success', 'Success'),
      description: t('videoEditor.export.successMessage', 'Export completed'),
      color: 'success',
    })

    emit('exported')
    isOpen.value = false
  } catch (err: any) {
    console.error('[TimelineExportModal] Export failed', err)
    exportError.value = err?.message || t('videoEditor.export.errorMessage', 'Export failed')
  } finally {
    exportPhase.value = null
    isExporting.value = false
  }
}

function handleCancel() {
  if (isExporting.value) return
  isOpen.value = false
}
</script>

<template>
  <UiAppModal
    v-model:open="isOpen"
    :title="t('videoEditor.export.title', 'Export')"
    :prevent-close="isExporting"
    :close-button="!isExporting"
  >
    <div class="flex flex-col gap-5">
      <div class="text-xs text-gray-500">
        {{ t('granVideoEditor.export.destination', 'Destination: export/') }}
      </div>

      <UFormField
        :label="t('videoEditor.export.filename', 'Filename')"
        :error="filenameError || undefined"
      >
        <UInput v-model="outputFilename" class="w-full" :disabled="isExporting" />
      </UFormField>

      <div class="grid grid-cols-2 gap-3">
        <UFormField :label="t('videoEditor.projectSettings.exportWidth', 'Width')">
          <UInput
            v-model.number="exportWidth"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :disabled="isExporting"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="t('videoEditor.projectSettings.exportHeight', 'Height')">
          <UInput
            v-model.number="exportHeight"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :disabled="isExporting"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField :label="t('videoEditor.projectSettings.exportFps', 'FPS')">
        <UInput
          v-model.number="exportFps"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          :disabled="isExporting"
          class="w-full"
        />
      </UFormField>

      <MediaEncodingSettings
        v-model:output-format="outputFormat"
        v-model:video-codec="videoCodec"
        v-model:bitrate-mbps="bitrateMbps"
        v-model:exclude-audio="excludeAudio"
        v-model:audio-bitrate-kbps="audioBitrateKbps"
        :disabled="isExporting"
        :has-audio="true"
        :is-loading-codec-support="isLoadingCodecSupport"
        :format-options="getFormatOptions()"
        :video-codec-options="getVideoCodecOptions()"
        :audio-codec-label="getAudioCodecLabel()"
      />

      <div v-if="isExporting" class="flex flex-col gap-2">
        <div class="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{{ getPhaseLabel() }}</span>
          <span>{{ exportProgress }}%</span>
        </div>
        <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-primary-500 rounded-full transition-all duration-300"
            :style="{ width: `${exportProgress}%` }"
          />
        </div>
      </div>

      <UAlert
        v-if="exportError"
        color="error"
        variant="soft"
        icon="i-heroicons-exclamation-triangle"
        :title="t('common.error', 'Error')"
        :description="exportError"
      />
    </div>

    <template #footer>
      <UButton variant="ghost" color="neutral" :disabled="isExporting" @click="handleCancel">
        {{ t('common.cancel', 'Cancel') }}
      </UButton>
      <UButton
        color="primary"
        :loading="isExporting"
        :disabled="isExporting || !!filenameError"
        icon="i-heroicons-arrow-down-tray"
        @click="handleConfirm"
      >
        {{ t('videoEditor.export.confirm', 'Export') }}
      </UButton>
    </template>
  </UiAppModal>
</template>
