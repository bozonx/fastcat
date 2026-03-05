<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useProxyStore } from '~/stores/proxy.store';
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

function onCreateProxy() {
  for (const e of props.entries) {
    if (e.kind === 'file' && e.path && getMediaTypeFromFilename(e.name) === 'video') {
      void proxyStore.generateProxy(e.handle as FileSystemFileHandle, e.path);
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
      class="bg-ui-bg-elevated p-4 rounded border border-ui-border flex flex-col items-center justify-center"
    >
      <UIcon name="i-heroicons-document-duplicate" class="w-8 h-8 text-ui-text-muted mb-2" />
      <span class="text-sm font-medium"
        >{{ entries.length }} {{ t('common.itemsSelected', 'items selected') }}</span
      >
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
