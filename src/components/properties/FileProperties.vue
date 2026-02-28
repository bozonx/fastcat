<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import yaml from 'js-yaml';
import MediaPlayer from '~/components/MediaPlayer.vue';

const props = defineProps<{
  selectedFsEntry: any;
  previewMode: 'original' | 'proxy';
  hasProxy: boolean;
}>();

const emit = defineEmits<{
  'update:previewMode': [val: 'original' | 'proxy'];
}>();

const { t } = useI18n();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();

const currentUrl = ref<string | null>(null);
const mediaType = ref<'image' | 'video' | 'audio' | 'text' | 'unknown' | null>(null);
const textContent = ref<string>('');
const fileInfo = ref<{
  name: string;
  kind: string;
  size?: number;
  lastModified?: number;
  metadata?: unknown;
} | null>(null);

const uploadInputRef = ref<HTMLInputElement | null>(null);

function triggerDirectoryUpload() {
  uploadInputRef.value?.click();
}

async function onDirectoryFileSelect(e: Event) {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;

  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!files || files.length === 0) return;

  const { useFileManager } = await import('~/composables/fileManager/useFileManager');
  const fm = useFileManager();
  await fm.handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
  await fm.loadProjectDirectory();
}

const isUnknown = computed(() => mediaType.value === 'unknown');

const timelinesUsingSelectedFile = computed(() => {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file' || !entry.path) return [];
  return timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
});

async function openTimelineFromUsage(path: string) {
  await projectStore.openTimelineFile(path);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}

const metadataYaml = computed(() => {
  if (!fileInfo.value?.metadata) return null;
  try {
    return yaml.dump(fileInfo.value.metadata, { indent: 2 });
  } catch {
    return String(fileInfo.value.metadata);
  }
});

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

async function computeDirectorySize(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number },
): Promise<number | undefined> {
  const maxEntries = options?.maxEntries ?? 25_000;
  let seen = 0;

  async function walk(handle: FileSystemDirectoryHandle): Promise<number> {
    const iterator =
      (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return 0;

    let total = 0;
    for await (const value of iterator) {
      if (seen >= maxEntries) {
        throw new Error('Directory too large');
      }
      seen += 1;

      const entryHandle = (Array.isArray(value) ? value[1] : value) as
        | FileSystemFileHandle
        | FileSystemDirectoryHandle;

      if (entryHandle.kind === 'file') {
        try {
          const f = await (entryHandle as FileSystemFileHandle).getFile();
          total += f.size;
        } catch {
          // ignore
        }
      } else {
        total += await walk(entryHandle as FileSystemDirectoryHandle);
      }
    }
    return total;
  }

  try {
    return await walk(dirHandle);
  } catch {
    return undefined;
  }
}

async function loadPreviewMedia() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }

  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  try {
    let fileToPlay: File;

    if (props.previewMode === 'proxy' && props.hasProxy && entry.path) {
      const proxyFile = await proxyStore.getProxyFile(entry.path);
      if (proxyFile) {
        fileToPlay = proxyFile;
      } else {
        fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
      }
    } else {
      fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
    }

    if (mediaType.value === 'image' || mediaType.value === 'video' || mediaType.value === 'audio') {
      currentUrl.value = URL.createObjectURL(fileToPlay);
    }
  } catch (e) {
    console.error('Failed to load preview media:', e);
  }
}

watch(
  () => props.previewMode,
  () => {
    void loadPreviewMedia();
  },
);

watch(
  () => props.selectedFsEntry,
  async (entry) => {
    // Revoke old URL
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }
    mediaType.value = null;
    textContent.value = '';
    fileInfo.value = null;
    emit('update:previewMode', 'original');

    if (!entry) return;

    if (entry.kind === 'directory') {
      fileInfo.value = {
        name: entry.name,
        kind: 'directory',
        size: await computeDirectorySize(entry.handle as FileSystemDirectoryHandle),
      };
      return;
    }

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

      const ext = entry.name.split('.').pop()?.toLowerCase();
      const textExtensions = ['txt', 'md', 'json', 'yaml', 'yml'];

      if (file.type.startsWith('image/')) {
        mediaType.value = 'image';
      } else if (file.type.startsWith('video/')) {
        mediaType.value = 'video';
      } else if (file.type.startsWith('audio/')) {
        mediaType.value = 'audio';
      } else if (textExtensions.includes(ext || '') || file.type.startsWith('text/')) {
        mediaType.value = 'text';
        // limit text read to first 1MB
        const textSlice = file.slice(0, 1024 * 1024);
        textContent.value = await textSlice.text();
        if (file.size > 1024 * 1024) {
          textContent.value += '\n... (truncated)';
        }
      } else {
        mediaType.value = 'unknown';
      }

      fileInfo.value = {
        name: file.name,
        kind: 'file',
        size: file.size,
        lastModified: file.lastModified,
        metadata:
          entry.path && (mediaType.value === 'video' || mediaType.value === 'audio')
            ? await mediaStore.getOrFetchMetadata(
                entry.handle as FileSystemFileHandle,
                entry.path,
                {
                  forceRefresh: true,
                },
              )
            : undefined,
      };

      if (
        mediaType.value === 'image' ||
        mediaType.value === 'video' ||
        mediaType.value === 'audio'
      ) {
        await loadPreviewMedia();
      }
    } catch (e) {
      console.error('Failed to preview file:', e);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});

function formatMegabytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <input
      ref="uploadInputRef"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <!-- Preview Box (only for files) -->
    <div
      v-if="selectedFsEntry?.kind === 'file'"
      class="w-full bg-ui-bg rounded border border-ui-border flex flex-col items-center justify-center min-h-50 overflow-hidden shrink-0"
    >
      <div
        v-if="isUnknown"
        class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
      >
        <UIcon name="i-heroicons-document" class="w-16 h-16" />
        <p class="text-sm text-center">
          {{
            t(
              'granVideoEditor.preview.unsupported',
              'Unsupported file format for visual preview',
            )
          }}
        </p>
      </div>

      <div v-else-if="currentUrl" class="w-full h-full flex flex-col">
        <img
          v-if="mediaType === 'image'"
          :src="currentUrl"
          class="max-w-full max-h-64 object-contain mx-auto my-auto"
        />
        <MediaPlayer
          v-else-if="mediaType === 'video' || mediaType === 'audio'"
          :src="currentUrl"
          :type="mediaType"
          class="w-full h-64"
        />
      </div>

      <pre
        v-else-if="mediaType === 'text'"
        class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-ui-text whitespace-pre-wrap"
        >{{ textContent }}</pre
      >
    </div>

    <!-- File Info -->
    <div
      v-if="fileInfo"
      class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border text-xs w-full"
    >
      <div class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5">
        <span class="text-xs text-ui-text-muted">{{ t('common.name', 'Name') }}</span>
        <span class="font-medium text-ui-text break-all">{{ fileInfo.name }}</span>
      </div>

      <div v-if="selectedFsEntry?.kind === 'directory'" class="flex">
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-heroicons-arrow-up-tray"
          class="w-full"
          @click="triggerDirectoryUpload"
        >
          {{ t('videoEditor.fileManager.actions.uploadFiles', 'Upload files') }}
        </UButton>
      </div>

      <div v-if="fileInfo.size !== undefined" class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5">
        <span class="text-xs text-ui-text-muted">{{ t('common.size', 'Size') }}</span>
        <span class="text-ui-text">{{ formatMegabytes(fileInfo.size) }}</span>
      </div>

      <div v-if="fileInfo.lastModified" class="flex flex-col gap-0.5 border-b border-ui-border pb-1.5">
        <span class="text-xs text-ui-text-muted">{{ t('common.modified', 'Modified') }}</span>
        <span class="text-ui-text">{{ new Date(fileInfo.lastModified).toLocaleString() }}</span>
      </div>

      <div v-if="metadataYaml" class="flex flex-col gap-1.5">
        <span class="text-xs text-ui-text-muted">{{ t('common.metadata', 'Metadata') }}</span>
        <pre class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded">{{ metadataYaml }}</pre>
      </div>
    </div>

    <!-- Usage in timelines -->
    <div v-if="timelinesUsingSelectedFile.length > 0" class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border">
      <div class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1">
        {{ t('granVideoEditor.preview.usedInTimelines', 'Used in timelines') }}
      </div>
      <div class="flex flex-wrap gap-1 mt-1">
        <UButton
          v-for="usage in timelinesUsingSelectedFile"
          :key="usage.timelinePath"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-clock"
          @click="openTimelineFromUsage(usage.timelinePath)"
        >
          {{ usage.timelineName.replace('.otio', '') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
