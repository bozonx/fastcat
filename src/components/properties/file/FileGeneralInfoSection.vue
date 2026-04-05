<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
interface FileInfo {
  kind: 'file' | 'directory';
  size?: number;
  createdAt?: number | string | Date | null;
  lastModified?: number | string | Date | null;
  filesCount?: number;
}

const props = defineProps<{
  title: string;
  fileInfo: FileInfo;
  selectedPath: string | null;
  isHidden: boolean;
  formatBytes: (bytes: number) => string;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="props.title">
    <PropertyRow
      v-if="props.selectedPath !== undefined && props.selectedPath !== null"
      :label="t('common.path', 'Path')"
      :value="props.selectedPath === '' ? '/' : props.selectedPath"
    />
    <template v-if="props.fileInfo.kind === 'directory'">
      <PropertyRow
        v-if="props.fileInfo.size !== undefined && props.fileInfo.size > 0"
        :label="t('common.size', 'Size')"
        :value="props.formatBytes(props.fileInfo.size)"
      />
      <PropertyRow
        v-if="props.fileInfo.filesCount !== undefined"
        :label="t('videoEditor.fileManager.folder.filesCount', 'Files Count')"
        :value="props.fileInfo.filesCount"
      />
      <PropertyRow
        v-if="props.fileInfo.size === undefined || props.fileInfo.size === 0"
        :label="t('common.type', 'Type')"
        :value="props.title === t('fastcat.file.bloggerDogGroup', 'Группа') ? t('fastcat.file.bloggerDogGroup', 'Группа') : props.title === t('fastcat.file.bloggerDogItem', 'Элемент контента') ? t('fastcat.file.bloggerDogItem', 'Элемент контента') : t('common.folder', 'Folder')"
      />
    </template>
    <PropertyRow
      v-else-if="props.fileInfo.size !== undefined && props.fileInfo.size > 0"
      :label="t('common.size', 'Size')"
      :value="props.formatBytes(props.fileInfo.size)"
    />
    <slot />
    <PropertyRow
      v-if="props.fileInfo.createdAt || props.fileInfo.lastModified"
      :label="t('common.created', 'Created')"
      :value="new Date(props.fileInfo.createdAt ?? props.fileInfo.lastModified!).toLocaleString()"
    />
    <PropertyRow
      v-if="props.fileInfo.lastModified"
      :label="t('common.updated', 'Updated')"
      :value="new Date(props.fileInfo.lastModified).toLocaleString()"
    />
    <PropertyRow v-if="props.isHidden" :label="t('common.hidden', 'Hidden')" value="Yes" />
    <div v-if="$slots['after-content']" class="mt-4 pt-2 border-t border-ui-border">
      <slot name="after-content" />
    </div>
  </PropertySection>
</template>
