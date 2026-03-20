<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import PropertySection from '~/components/properties/PropertySection.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';

const props = defineProps<{
  entries: FsEntry[];
}>();

const { t } = useI18n();
const uiStore = useUiStore();
const proxyStore = useProxyStore();
const projectStore = useProjectStore();

const totalSize = computed(() => {
  return props.entries.reduce((acc, e) => acc + (e.kind === 'file' ? (e as any).size || 0 : 0), 0);
});

const typeBreakdown = computed(() => {
  const counts: Record<string, number> = {};
  props.entries.forEach((e) => {
    const type = e.kind === 'directory' ? 'folder' : getMediaTypeFromFilename(e.name);
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
});

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

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
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <div
      class="bg-ui-bg-elevated p-4 rounded border border-ui-border flex flex-col gap-3"
    >
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
