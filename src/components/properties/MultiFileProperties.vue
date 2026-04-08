<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { formatBytes } from '~/utils/format';
import { computeDirectoryStats } from '~/utils/fs';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import PropertySection from '~/components/properties/PropertySection.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  entries: FsEntry[];
}>();

const { t } = useI18n();
const uiStore = useUiStore();
const proxyStore = useProxyStore();
const projectStore = useProjectStore();
const fileManager = useFileManager();
const clipboardStore = useAppClipboard();

const totalSize = ref(0);

watch(
  () => props.entries,
  async (entries) => {
    let size = 0;
    for (const e of entries) {
      if (e.kind === 'file' && e.path) {
        const file = await fileManager.vfs.getFile(e.path);
        if (file) {
          size += file.size;
        }
      } else if (e.kind === 'directory' && e.path) {
        try {
          const handle = await projectStore.getDirectoryHandleByPath(e.path);
          if (handle) {
            const stats = await computeDirectoryStats(handle);
            if (stats) {
              size += stats.size;
            }
          }
        } catch (err) {
          console.warn('Failed to calculate directory size for properties:', e.path, err);
        }
      }
    }
    totalSize.value = size;
  },
  { immediate: true, deep: true },
);

const typeBreakdown = computed(() => {
  const counts: Record<string, number> = {};
  props.entries.forEach((e) => {
    const type = e.kind === 'directory' ? 'folder' : getMediaTypeFromFilename(e.name);
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
});

const hasVideo = computed(() => {
  return props.entries.some(
    (e) => e.kind === 'file' && getMediaTypeFromFilename(e.name) === 'video',
  );
});

const hasExistingProxy = computed(() => {
  return props.entries.some((e) => e.path && proxyStore.existingProxies.has(e.path));
});

const isGeneratingProxy = computed(() => {
  return props.entries.some((e) => e.path && proxyStore.generatingProxies.has(e.path));
});

function onDelete() {
  uiStore.pendingFsEntryDelete = props.entries;
}

const { extractAudio } = useAudioExtraction();

async function handleExtractAudio() {
  if (!props.entries.length) return;
  for (const entry of props.entries) {
    if (entry.kind === 'file' && getMediaTypeFromFilename(entry.name) === 'video') {
      await extractAudio(entry);
    }
  }
}

async function onCreateProxy() {
  for (const e of props.entries) {
    if (e.kind === 'file' && e.path && getMediaTypeFromFilename(e.name) === 'video') {
      const file = await projectStore.getFileByPath(e.path);
      if (!file) continue;
      void proxyStore.generateProxy(file, e.path);
    }
  }
}

function onCancelProxy() {
  for (const e of props.entries) {
    if (e.kind === 'file' && e.path && proxyStore.generatingProxies.has(e.path)) {
      void proxyStore.cancelProxyGeneration(e.path);
    }
  }
}

function onDeleteProxy() {
  for (const e of props.entries) {
    if (e.kind === 'file' && e.path && proxyStore.existingProxies.has(e.path)) {
      void proxyStore.deleteProxy(e.path);
    }
  }
}

function onCopy() {
  const validEntries = props.entries.filter((e) => Boolean(e.path));
  if (validEntries.length === 0) return;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'copy',
    items: validEntries.map((e) => ({
      path: e.path!,
      kind: e.kind,
      name: e.name,
    })),
  });
}

function onCut() {
  const validEntries = props.entries.filter((e) => Boolean(e.path));
  if (validEntries.length === 0) return;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'cut',
    items: validEntries.map((e) => ({
      path: e.path!,
      kind: e.kind,
      name: e.name,
    })),
  });
}
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <div class="bg-ui-bg-elevated p-4 rounded border border-ui-border flex flex-col gap-3">
      <div class="flex flex-col items-center justify-center">
        <UIcon name="i-heroicons-document-duplicate" class="w-8 h-8 text-ui-text-muted mb-2" />
        <span class="text-sm font-medium"
          >{{ entries.length }} {{ t('common.itemsSelected', 'items selected') }}</span
        >
      </div>

      <div class="border-t border-ui-border pt-3 flex flex-col gap-1">
        <div v-if="totalSize > 0" class="flex justify-between text-xs">
          <span class="text-ui-text-muted">{{ t('common.totalSize', 'Total Size') }}</span>
          <span class="text-ui-text font-mono">{{ formatBytes(totalSize) }}</span>
        </div>
        <div
          v-for="(count, type) in typeBreakdown"
          :key="type"
          class="flex justify-between text-xs capitalize"
        >
          <span class="text-ui-text-muted">{{ type }}s</span>
          <span class="text-ui-text">{{ count }}</span>
        </div>
      </div>
    </div>

    <PropertySection :title="t('videoEditor.fileManager.actions.title', 'Actions')">
      <EntryActions
        :primary-actions="[
          {
            id: 'copy',
            title: t('common.copy', 'Copy'),
            icon: 'i-heroicons-document-duplicate',
            onClick: onCopy,
          },
          {
            id: 'cut',
            title: t('common.cut', 'Cut'),
            icon: 'i-heroicons-scissors',
            onClick: onCut,
          },
          {
            id: 'delete',
            title: t('common.delete', 'Delete'),
            icon: 'i-heroicons-trash',
            onClick: onDelete,
          },
        ]"
        :secondary-actions="[
          {
            id: 'createProxy',
            label: t('videoEditor.fileManager.proxy.create', 'Create proxy'),
            icon: 'i-heroicons-film',
            hidden: !hasVideo || isGeneratingProxy,
            onClick: onCreateProxy,
          },
          {
            id: 'cancelProxy',
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            hidden: !isGeneratingProxy,
            onClick: onCancelProxy,
          },
          {
            id: 'extractAudio',
            label: t('videoEditor.fileManager.actions.extractAudio', 'Extract Audio'),
            icon: 'i-heroicons-musical-note',
            hidden: !hasVideo,
            onClick: handleExtractAudio,
          },
          {
            id: 'deleteProxy',
            label: t('videoEditor.fileManager.proxy.delete', 'Delete proxy'),
            icon: 'i-heroicons-trash',
            color: 'error',
            hidden: !hasExistingProxy,
            onClick: onDeleteProxy,
          },
        ]"
      />
    </PropertySection>
  </div>
</template>
