<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
interface FileInfo {
  size?: number;
  createdAt?: number | string | Date | null;
  lastModified?: number | string | Date | null;
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
    <PropertyRow
      v-if="props.fileInfo.size !== undefined"
      :label="t('common.size', 'Size')"
      :value="props.formatBytes(props.fileInfo.size)"
    />
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
  </PropertySection>
</template>
