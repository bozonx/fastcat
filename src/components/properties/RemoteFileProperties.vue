<script setup lang="ts">
import { computed } from 'vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import type { RemoteVfsEntry, RemoteVfsFileEntry } from '~/types/remote-vfs';
import { formatBytes } from '~/utils/format';

const props = defineProps<{
  selectedFsEntry: {
    kind: 'file' | 'directory';
    name: string;
    path?: string;
    remoteData?: unknown;
  };
}>();

const { t } = useI18n();

const remoteData = computed(
  () => (props.selectedFsEntry.remoteData ?? null) as RemoteVfsEntry | null,
);
const remoteFile = computed(
  () => (remoteData.value?.type === 'file' ? remoteData.value : null) as RemoteVfsFileEntry | null,
);
const firstMedia = computed(() => remoteFile.value?.media?.[0] ?? null);
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <PropertySection :title="t('videoEditor.fileManager.actions.title', 'Actions')">
      <div class="text-xs text-ui-text-muted">
        {{ t('videoEditor.settings.integrationSourceFastCat', 'FastCat Publicador') }}
      </div>
    </PropertySection>

    <PropertySection
      :title="
        remoteData?.type === 'directory' ? t('common.folder', 'Folder') : t('common.file', 'File')
      "
    >
      <PropertyRow :label="t('common.name', 'Name')" :value="selectedFsEntry.name" />
      <PropertyRow :label="t('common.path', 'Path')" :value="selectedFsEntry.path || '/'" />
      <PropertyRow
        v-if="remoteData?.type === 'directory'"
        :label="t('common.items', 'Items')"
        :value="(remoteData as any)?.itemsCount ?? '-'"
      />
      <PropertyRow
        v-if="firstMedia?.size"
        :label="t('common.size', 'Size')"
        :value="formatBytes(firstMedia.size)"
      />
      <PropertyRow
        v-if="firstMedia?.mimeType"
        :label="t('common.type', 'Type')"
        :value="firstMedia.mimeType"
      />
      <PropertyRow
        v-if="remoteFile?.language"
        :label="t('common.language', 'Language')"
        :value="remoteFile.language"
      />
      <PropertyRow
        v-if="remoteFile?.tags?.length"
        :label="t('common.tags', 'Tags')"
        :value="remoteFile.tags.join(', ')"
      />
    </PropertySection>

    <PropertySection v-if="remoteFile?.text" :title="t('common.text', 'Text')">
      <div class="text-xs text-ui-text whitespace-pre-wrap wrap-break-word max-h-60 overflow-auto">
        {{ remoteFile.text }}
      </div>
    </PropertySection>
  </div>
</template>
