<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { formatBytes } from '~/utils/format';

const props = defineProps<{
  isProjectRootDir: boolean;
  projectName: string | null | undefined;
  storageFreeBytes: number | null;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection
    v-if="props.isProjectRootDir"
    :title="t('videoEditor.fileManager.projectRoot.title', 'Project root')"
  >
    <PropertyRow
      :label="t('videoEditor.fileManager.projectRoot.project', 'Project')"
      :value="props.projectName ?? '-'"
    />
    <PropertyRow
      v-if="props.storageFreeBytes !== null"
      :label="t('videoEditor.fileManager.projectRoot.freeSpace', 'Free space')"
      :value="formatBytes(props.storageFreeBytes)"
    />
  </PropertySection>
</template>
