<script setup lang="ts">
import yaml from 'js-yaml';
import AppModal from '~/components/ui/AppModal.vue';

import type { FileInfo } from '~/types/fileManager';

import { formatMegabytes } from '~/utils/format';

const isOpen = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  info: FileInfo | null;
}>();

const { t } = useI18n();

const metadataYaml = computed(() => {
  if (!props.info?.metadata) return null;
  try {
    return yaml.dump(props.info.metadata, { indent: 2 });
  } catch (e) {
    return String(props.info.metadata);
  }
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.info.title', 'File Information')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div v-if="info" class="space-y-4">
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1 border-b border-ui-border pb-2">
          <span class="text-sm text-ui-text-muted">{{ t('common.name', 'Name') }}</span>
          <span class="font-medium text-ui-text break-all">{{ info.name }}</span>
        </div>
        <div class="flex flex-col gap-1 border-b border-ui-border pb-2">
          <span class="text-sm text-ui-text-muted">{{ t('common.type', 'Type') }}</span>
          <span class="font-medium text-ui-text">
            {{
              info.kind === 'directory' ? t('common.folder', 'Folder') : t('common.file', 'File')
            }}
          </span>
        </div>
        <div
          v-if="info.size !== undefined"
          class="flex flex-col gap-1 border-b border-ui-border pb-2"
        >
          <span class="text-sm text-ui-text-muted">{{ t('common.size', 'Size') }}</span>
          <span class="font-medium text-ui-text">{{ formatMegabytes(info.size) }}</span>
        </div>
        <div v-if="info.lastModified" class="flex flex-col gap-1 pb-2">
          <span class="text-sm text-ui-text-muted">{{ t('common.modified', 'Modified') }}</span>
          <span class="font-medium text-ui-text">{{
            new Date(info.lastModified).toLocaleString()
          }}</span>
        </div>
        <div v-if="metadataYaml" class="flex flex-col gap-1 border-t border-ui-border pt-2 pb-2">
          <span class="text-sm text-ui-text-muted">{{
            t('videoEditor.fileManager.info.metadata', 'Metadata')
          }}</span>
          <pre
            class="bg-ui-bg p-2 rounded text-[10px] font-mono overflow-auto max-h-64 whitespace-pre text-ui-text-muted"
            >{{ metadataYaml }}</pre
          >
        </div>
      </div>
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="isOpen = false">
        {{ t('common.close', 'Close') }}
      </UButton>
    </template>
  </AppModal>
</template>
