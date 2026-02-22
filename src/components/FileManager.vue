<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store'
import { useProjectStore } from '~/stores/project.store'
import { useTimelineStore } from '~/stores/timeline.store'
import { useUiStore } from '~/stores/ui.store'
import { useMediaStore } from '~/stores/media.store'
import CreateFolderModal from '~/components/common/CreateFolderModal.vue'
import FileInfoModal from '~/components/common/FileInfoModal.vue'
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue'
import RenameModal from '~/components/common/RenameModal.vue'
import type { FileInfo } from '~/components/common/FileInfoModal.vue'
import MediaEncodingSettings, { type FormatOption } from '~/components/media/MediaEncodingSettings.vue'
import {
  BASE_VIDEO_CODEC_OPTIONS,
  checkVideoCodecSupport,
  resolveVideoCodecOptions,
} from '~/utils/webcodecs'

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const projectStore = useProjectStore()
const timelineStore = useTimelineStore()
const uiStore = useUiStore()
const mediaStore = useMediaStore()

interface FsEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  parentHandle?: FileSystemDirectoryHandle
  children?: FsEntry[]
  expanded?: boolean
  path?: string
}

const activeTab = ref('files')
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const formatOptions: readonly FormatOption[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM (VP9 + Opus)' },
  { value: 'mkv', label: 'MKV (AV1 + Opus)' },
]

const videoCodecSupport = ref<Record<string, boolean>>({})
const isLoadingCodecSupport = ref(false)

const videoCodecOptions = computed(() =>
  resolveVideoCodecOptions(BASE_VIDEO_CODEC_OPTIONS, videoCodecSupport.value),
)

async function loadCodecSupport() {
  if (isLoadingCodecSupport.value) return
  isLoadingCodecSupport.value = true
  try {
    videoCodecSupport.value = await checkVideoCodecSupport(BASE_VIDEO_CODEC_OPTIONS)
    const selected = projectStore.projectSettings.export.encoding.videoCodec
    if (videoCodecSupport.value[selected] === false) {
      const firstSupported = BASE_VIDEO_CODEC_OPTIONS.find((opt) => videoCodecSupport.value[opt.value])
      if (firstSupported) projectStore.projectSettings.export.encoding.videoCodec = firstSupported.value
    }
  } finally {
    isLoadingCodecSupport.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'project') {
    loadCodecSupport()
  }
})

const rootEntries = ref<FsEntry[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

const isApiSupported = workspaceStore.isApiSupported

const isCreateFolderModalOpen = ref(false)
const folderCreationTarget = ref<FileSystemDirectoryHandle | null>(null)

const isRenameModalOpen = ref(false)
const renameTarget = ref<FsEntry | null>(null)

const isFileInfoModalOpen = ref(false)
const currentFileInfo = ref<FileInfo | null>(null)

const isDeleteConfirmModalOpen = ref(false)
const deleteTarget = ref<FsEntry | null>(null)

const rootContextMenuItems = computed(() => {
  if (!projectStore.currentProjectName) return []
  return [[{
    label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
    icon: 'i-heroicons-folder-plus',
    onSelect: () => openCreateFolderModal(null)
  }]]
})

async function readDirectory(dirHandle: FileSystemDirectoryHandle, basePath = ''): Promise<FsEntry[]> {
  const entries: FsEntry[] = []
  try {
    const iterator = (dirHandle as any).values?.() ?? (dirHandle as any).entries?.()
    if (!iterator) return entries

    for await (const value of iterator) {
      const handle = Array.isArray(value) ? value[1] : value
      entries.push({
        name: handle.name,
        kind: handle.kind,
        handle,
        parentHandle: dirHandle,
        children: undefined,
        expanded: false,
        path: basePath ? `${basePath}/${handle.name}` : handle.name,
      })
    }
  } catch (e: any) {
    throw new Error(e?.message ?? 'Failed to read directory')
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function expandPersistedDirectories() {
  const projectName = projectStore.currentProjectName
  if (!projectName) return

  const expandedPaths = Object.keys(uiStore.fileTreeExpandedPaths)
  if (expandedPaths.length === 0) return

  const sortedPaths = [...expandedPaths].sort((a, b) => a.length - b.length)

  for (const path of sortedPaths) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) continue

    let currentList = rootEntries.value
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const entry = currentList.find((e) => e.kind === 'directory' && e.name === part)
      if (!entry) break

      if (!entry.expanded) {
        await toggleDirectory(entry)
      } else if (entry.children === undefined) {
        entry.children = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path)
      }

      if (!uiStore.isFileTreePathExpanded(currentPath)) {
        uiStore.setFileTreePathExpanded(projectName, currentPath, true)
      }

      currentList = entry.children ?? []
    }
  }
}

async function loadProjectDirectory() {
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
    rootEntries.value = []
    return
  }
  
  error.value = null
  isLoading.value = true
  try {
    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName)
    rootEntries.value = await readDirectory(projectDir)

    await expandPersistedDirectories()

    // Automatically expand the sources directory if present
    for (const entry of rootEntries.value) {
      if (entry.kind === 'directory' && entry.name === 'sources') {
        if (!entry.expanded) await toggleDirectory(entry)
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      error.value = e?.message ?? 'Failed to open project folder'
    }
  } finally {
    isLoading.value = false
  }
}

watch(() => projectStore.currentProjectName, loadProjectDirectory, { immediate: true })

async function toggleDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return
  error.value = null
  entry.expanded = !entry.expanded

  if (entry.path) {
    if (projectStore.currentProjectName) {
      uiStore.setFileTreePathExpanded(projectStore.currentProjectName, entry.path, entry.expanded)
    }
  }

  if (entry.expanded && entry.children === undefined) {
    try {
      entry.children = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path)
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to read folder'
      entry.expanded = false

      if (entry.path) {
        if (projectStore.currentProjectName) {
          uiStore.setFileTreePathExpanded(projectStore.currentProjectName, entry.path, false)
        }
      }
    }
  }
}

function getFileIcon(entry: FsEntry): string {
  if (entry.kind === 'directory') return 'i-heroicons-folder'
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'i-heroicons-film'
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'i-heroicons-musical-note'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'i-heroicons-photo'
  if (ext === 'otio') return 'i-heroicons-document-text'
  return 'i-heroicons-document'
}

async function handleFiles(files: FileList | File[]) {
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return

  error.value = null
  isLoading.value = true
  try {
    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName)
    const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true })

    for (const file of Array.from(files)) {
      let targetDirName = 'video'
      if (file.type.startsWith('audio/')) targetDirName = 'audio'
      else if (file.type.startsWith('image/')) targetDirName = 'images'
      else if (!file.type.startsWith('video/')) {
        // Default to video or just keep in sources? For now follow the prompt: video/audio/image
        // If it's something else, maybe we skip or put in video as default "source"
        if (file.name.endsWith('.otio')) continue // Skip project files
      }

      const targetDir = await sourcesDir.getDirectoryHandle(targetDirName, { create: true })
      const fileHandle = await targetDir.getFileHandle(file.name, { create: true })
      const writable = await (fileHandle as any).createWritable()
      await writable.write(file)
      await writable.close()

      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const projectRelativePath = `sources/${targetDirName}/${file.name}`
        void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath)
      }
    }

    await loadProjectDirectory()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to upload files'
  } finally {
    isLoading.value = false
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files) {
    handleFiles(e.dataTransfer.files)
  }
}

function openCreateFolderModal(targetEntry: FsEntry | null = null) {
  folderCreationTarget.value = targetEntry?.kind === 'directory' ? targetEntry.handle as FileSystemDirectoryHandle : null
  isCreateFolderModalOpen.value = true
}

async function handleCreateFolder(name: string) {
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return
  
  error.value = null
  isLoading.value = true
  try {
    const baseDir =
      folderCreationTarget.value ||
      (await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName))
    await baseDir.getDirectoryHandle(name, { create: true })
    await loadProjectDirectory()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create folder'
  } finally {
    isLoading.value = false
  }
}

async function openFileInfoModal(entry: FsEntry) {
  let size: number | undefined
  let lastModified: number | undefined

  if (entry.kind === 'file') {
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile()
      size = file.size
      lastModified = file.lastModified
    } catch (e) {
      // ignore
    }
  }

  currentFileInfo.value = {
    name: entry.name,
    kind: entry.kind,
    size,
    lastModified,
    path: entry.path,
    metadata: entry.kind === 'file' && entry.path
      ? await mediaStore.getOrFetchMetadata(entry.handle as FileSystemFileHandle, entry.path, { forceRefresh: true })
      : undefined
  }
  isFileInfoModalOpen.value = true
}

function openDeleteConfirmModal(entry: FsEntry) {
  deleteTarget.value = entry
  isDeleteConfirmModalOpen.value = true
}

async function handleDeleteConfirm() {
  if (!deleteTarget.value) return
  
  error.value = null
  isLoading.value = true
  try {
    const parent = deleteTarget.value.parentHandle
    if (parent) {
      await parent.removeEntry(deleteTarget.value.name, { recursive: true })
    }
    await loadProjectDirectory()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to delete'
  } finally {
    isLoading.value = false
    deleteTarget.value = null
  }
}

async function handleRename(newName: string) {
  if (!renameTarget.value || !renameTarget.value.parentHandle) return

  error.value = null
  isLoading.value = true
  try {
    const parent = renameTarget.value.parentHandle
    if (renameTarget.value.kind === 'file') {
      const handle = renameTarget.value.handle as any
      if (typeof handle.move === 'function') {
        await handle.move(newName)
      } else {
        const file = await (handle as FileSystemFileHandle).getFile()
        const newHandle = await parent.getFileHandle(newName, { create: true })
        const writable = await (newHandle as any).createWritable()
        await writable.write(file)
        await writable.close()
        await parent.removeEntry(renameTarget.value.name)
      }
    } else {
      const oldHandle = renameTarget.value.handle as FileSystemDirectoryHandle
      const newHandle = await parent.getDirectoryHandle(newName, { create: true })
      
      async function copyDirectory(srcDir: FileSystemDirectoryHandle, destDir: FileSystemDirectoryHandle) {
        const iterator = (srcDir as any).values?.() ?? (srcDir as any).entries?.()
        if (!iterator) return
        for await (const value of iterator) {
          const handle = Array.isArray(value) ? value[1] : value
          if (handle.kind === 'file') {
            const file = await handle.getFile()
            const newFileHandle = await destDir.getFileHandle(handle.name, { create: true })
            const writable = await (newFileHandle as any).createWritable()
            await writable.write(file)
            await writable.close()
          } else if (handle.kind === 'directory') {
            const newSubDir = await destDir.getDirectoryHandle(handle.name, { create: true })
            await copyDirectory(handle, newSubDir)
          }
        }
      }
      
      await copyDirectory(oldHandle, newHandle)
      await parent.removeEntry(renameTarget.value.name, { recursive: true })
    }
    
    await loadProjectDirectory()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to rename'
  } finally {
    isLoading.value = false
    renameTarget.value = null
  }
}

function onFileAction(action: 'createFolder' | 'rename' | 'info' | 'delete', entry: FsEntry) {
  if (action === 'createFolder') {
    openCreateFolderModal(entry)
  } else if (action === 'rename') {
    renameTarget.value = entry
    isRenameModalOpen.value = true
  } else if (action === 'info') {
    openFileInfoModal(entry)
  } else if (action === 'delete') {
    openDeleteConfirmModal(entry)
  }
}

async function onEntrySelect(entry: FsEntry) {
  uiStore.selectedFsEntry = entry as any

  if (entry.kind !== 'file') return
  if (!entry.path?.toLowerCase().endsWith('.otio')) return

  await projectStore.openTimelineFile(entry.path)
  await timelineStore.loadTimeline()
  void timelineStore.loadTimelineMetadata()
}

function triggerFileUpload() {
  fileInput.value?.click()
}

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) {
    handleFiles(target.files)
  }
}

async function createTimeline() {
  if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return

  error.value = null
  isLoading.value = true
  try {
    const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName)
    const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true })
    const timelinesDir = await sourcesDir.getDirectoryHandle('timelines', { create: true })

    // Find unique filename
    let index = 1
    let fileName = ''
    let exists = true
    while (exists) {
      fileName = `timeline_${String(index).padStart(3, '0')}.otio`
      try {
        await timelinesDir.getFileHandle(fileName)
        index++
      } catch (e) {
        exists = false
      }
    }

    const fileHandle = await timelinesDir.getFileHandle(fileName, { create: true })
    const writable = await (fileHandle as any).createWritable()
    await writable.write(`{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "${fileName.replace('.otio', '')}",
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "children": [],
    "name": "tracks"
  }
}`)
    await writable.close()

    await loadProjectDirectory()
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to create timeline'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-gray-900 border-r border-gray-800 transition-colors duration-200 min-w-0 overflow-hidden"
    :class="{ 'bg-gray-800/50 ring-2 ring-inset ring-primary-500/50': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      @change="onFileSelect"
    >

    <!-- Header / Tabs -->
    <div class="flex items-center gap-4 px-3 py-2 border-b border-gray-800 shrink-0 select-none">
      <button 
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'project' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'project'"
      >
        {{ t('videoEditor.fileManager.tabs.project', 'Project') }}
      </button>
      <button 
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'files' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'files'"
      >
        {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
      </button>
      <button 
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'effects' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'effects'"
      >
        {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
      </button>
    </div>

    <!-- Actions Toolbar (only for Files tab) -->
    <div
      v-if="activeTab === 'files' && projectStore.currentProjectName"
      class="flex items-center gap-1 px-2 py-1 bg-gray-800/30 border-b border-gray-800/50"
    >
      <UButton
        icon="i-heroicons-folder-plus"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.createFolder')"
        @click="openCreateFolderModal(null)"
      />
      <UButton
        icon="i-heroicons-arrow-up-tray"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.uploadFiles')"
        @click="triggerFileUpload"
      />
      <UButton
        icon="i-heroicons-document-plus"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline')"
        @click="createTimeline"
      />
    </div>

    <!-- Content -->
    <div v-if="activeTab === 'project'" class="flex-1 overflow-y-auto min-h-0 min-w-0">
      <div class="flex flex-col gap-6 px-3 py-3">
        <div class="text-xs text-gray-500">
          {{ t('videoEditor.projectSettings.note', 'Settings are saved to .gran/project.settings.json') }}
        </div>

        <div class="flex flex-col gap-3">
          <div class="text-sm font-medium text-gray-200">
            {{ t('videoEditor.projectSettings.export', 'Export') }}
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('videoEditor.projectSettings.exportWidth', 'Width')">
              <UInput
                v-model.number="projectStore.projectSettings.export.width"
                type="number"
                inputmode="numeric"
                min="1"
                step="1"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('videoEditor.projectSettings.exportHeight', 'Height')">
              <UInput
                v-model.number="projectStore.projectSettings.export.height"
                type="number"
                inputmode="numeric"
                min="1"
                step="1"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField :label="t('videoEditor.projectSettings.exportFps', 'FPS')">
            <UInput
              v-model.number="projectStore.projectSettings.export.fps"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>

          <MediaEncodingSettings
            v-model:output-format="projectStore.projectSettings.export.encoding.format"
            v-model:video-codec="projectStore.projectSettings.export.encoding.videoCodec"
            v-model:bitrate-mbps="projectStore.projectSettings.export.encoding.bitrateMbps"
            v-model:exclude-audio="projectStore.projectSettings.export.encoding.excludeAudio"
            v-model:audio-bitrate-kbps="projectStore.projectSettings.export.encoding.audioBitrateKbps"
            :disabled="false"
            :has-audio="true"
            :is-loading-codec-support="isLoadingCodecSupport"
            :format-options="formatOptions"
            :video-codec-options="videoCodecOptions"
            audio-codec-label="AAC"
          />
        </div>

        <div class="flex flex-col gap-3">
          <div class="text-sm font-medium text-gray-200">
            {{ t('videoEditor.projectSettings.proxy', 'Proxy') }}
          </div>

          <UFormField :label="t('videoEditor.projectSettings.proxyHeight', 'Height')">
            <UInput
              v-model.number="projectStore.projectSettings.proxy.height"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </div>

    <div
      v-else-if="activeTab === 'files'"
      class="flex-1 overflow-auto min-h-0 min-w-0 relative"
    >
      <UContextMenu
        :items="rootContextMenuItems"
      >
        <div class="min-w-full w-max min-h-full flex flex-col">
          <!-- Dropzone Overlay -->
          <div
            v-if="isDragging"
            class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm border-2 border-dashed border-primary-500 m-2 rounded-lg pointer-events-none"
          >
            <UIcon name="i-heroicons-arrow-down-tray" class="w-12 h-12 text-primary-500 mb-2 animate-bounce" />
            <p class="text-sm font-medium text-primary-400">
              {{ t('videoEditor.fileManager.actions.dropFilesHere', 'Drop files here') }}
            </p>
          </div>

          <div v-if="isLoading" class="px-3 py-4 text-sm text-gray-400">
            {{ t('common.loading', 'Loading...') }}
          </div>

          <!-- Empty state -->
          <div
            v-else-if="rootEntries.length === 0 && !error"
            class="flex flex-col items-center justify-center flex-1 w-full gap-3 text-gray-600 px-4 text-center min-h-[200px]"
          >
            <UIcon name="i-heroicons-folder-open" class="w-10 h-10" />
            <p class="text-sm">
              {{ isApiSupported
                ? t('videoEditor.fileManager.empty', 'No files in this project')
                : t('videoEditor.fileManager.unsupported', 'File System Access API is not supported in this browser') }}
            </p>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="px-3 py-4 text-sm text-red-500 bg-red-500/10 m-2 rounded">
            {{ error }}
          </div>

          <!-- File tree -->
          <FileManagerTree
            v-else
            :entries="rootEntries"
            :depth="0"
            :get-file-icon="getFileIcon"
            @toggle="toggleDirectory"
            @select="onEntrySelect"
            @action="onFileAction"
          />
        </div>
      </UContextMenu>
    </div>

    <div v-else-if="activeTab === 'effects'" class="flex-1 overflow-y-auto relative">
      <div class="flex flex-col items-center justify-center h-full text-gray-600 px-4 text-center">
        <UIcon name="i-heroicons-sparkles" class="w-10 h-10 mb-3" />
        <p class="text-sm italic">
          {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
          {{ t('common.noData', '(coming soon)') }}
        </p>
      </div>
    </div>

    <CreateFolderModal
      v-model:open="isCreateFolderModalOpen"
      @create="handleCreateFolder"
    />

    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="renameTarget?.name"
      @rename="handleRename"
    />

    <FileInfoModal
      v-model:open="isFileInfoModalOpen"
      :info="currentFileInfo"
    />

    <UiConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :title="t('common.delete', 'Delete')"
      :description="t('common.confirmDelete', 'Are you sure you want to delete this? This action cannot be undone.')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleDeleteConfirm"
    >
      <div v-if="deleteTarget" class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
        {{ deleteTarget.name }}
      </div>
    </UiConfirmModal>
  </div>
</template>
