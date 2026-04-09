<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
interface FileInfo {
  kind: 'file' | 'directory';
  name: string;
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
  mediaCount?: number;
  pathLink?: string | null;
  hideHeader?: boolean;
  instanceId?: string;
  isExternal?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="props.hideHeader ? undefined : props.title">
    <PropertyRow
      v-if="props.selectedPath !== undefined && props.selectedPath !== null"
      :label="t('common.path', 'Path')"
    >
      <NuxtLink
        v-if="props.pathLink"
        :to="props.pathLink"
        target="_blank"
        class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
      >
        <span class="truncate">{{ props.fileInfo.name }}</span>
        <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
      </NuxtLink>
      <span v-else>
        {{ props.selectedPath === '' ? '/' : props.selectedPath }}
      </span>
    </PropertyRow>
    <template v-if="props.fileInfo.kind === 'directory'">
      <PropertyRow
        v-if="props.fileInfo.size !== undefined && props.fileInfo.size > 0 && props.instanceId !== 'computer' && props.instanceId !== 'sidebar' && !props.isExternal"
        :label="t('common.size', 'Size')"
        :value="props.formatBytes(props.fileInfo.size)"
      />
      <PropertyRow
        v-if="props.fileInfo.filesCount !== undefined && props.mediaCount === undefined && !props.pathLink && props.instanceId !== 'computer' && props.instanceId !== 'sidebar'"
        :label="t('videoEditor.fileManager.folder.filesCount', 'Files Count')"
        :value="props.fileInfo.filesCount"
      />
      <PropertyRow
        v-if="props.fileInfo.size === undefined || props.fileInfo.size === 0"
        :label="t('common.type', 'Type')"
        :value="props.title === t('fastcat.file.bloggerDogGroup', 'Группа') ? t('fastcat.file.bloggerDogGroup', 'Группа') : props.title === t('fastcat.file.bloggerDogItem', 'Элемент контента') ? t('fastcat.file.bloggerDogItem', 'Элемент контента') : t('common.folder', 'Folder')"
      />
      <PropertyRow
        v-if="props.mediaCount !== undefined"
        :label="t('fastcat.file.mediaCount', 'Количество файлов')"
        :value="props.mediaCount"
      />
    </template>
    <PropertyRow
      v-else-if="props.fileInfo.size !== undefined && props.fileInfo.size > 0"
      :label="t('common.size', 'Size')"
      :value="props.formatBytes(props.fileInfo.size)"
    />
    <PropertyRow
      v-if="props.fileInfo.kind === 'file' && props.mediaCount !== undefined"
      :label="t('fastcat.file.mediaCount', 'Количество файлов')"
      :value="props.mediaCount"
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
