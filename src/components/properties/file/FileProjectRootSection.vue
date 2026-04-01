<script setup lang="ts">
import { computed } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { formatBytes } from '~/utils/format';
import { useProjectSettingsStore } from '~/stores/project-settings.store';
import { useUiStore } from '~/stores/ui.store';
import type { DirectoryStats } from '~/utils/fs';

const props = defineProps<{
  isProjectRootDir: boolean;
  projectName: string | null | undefined;
  storageFreeBytes: number | null;
  projectStats: DirectoryStats | null;
}>();

const { t } = useI18n();
const projectSettingsStore = useProjectSettingsStore();
const uiStore = useUiStore();

const projectParams = computed(() => {
  const p = projectSettingsStore.projectSettings.project;
  const resolution = p.isCustomResolution ? `${p.width}x${p.height}` : p.resolutionFormat;
  return `${resolution}, ${p.fps}FPS, ${Math.round(p.sampleRate / 1000)}kHz`;
});

function openProjectSettings() {
  uiStore.isProjectSettingsOpen = true;
}
</script>

<template>
  <PropertySection
    v-if="props.isProjectRootDir"
    :title="t('videoEditor.fileManager.projectRoot.title', 'Project root')"
  >
    <PropertyRow
      v-if="props.projectStats?.size !== undefined"
      :label="t('common.size', 'Size')"
      :value="formatBytes(props.projectStats!.size)"
    />

    <PropertyRow
      v-if="props.storageFreeBytes !== null"
      :label="t('videoEditor.fileManager.projectRoot.freeSpace', 'Free space')"
      :value="formatBytes(props.storageFreeBytes)"
    />

    <PropertyRow :label="t('videoEditor.fileManager.projectRoot.parameters', 'Parameters')">
      <div class="flex items-center gap-2">
        <span>{{ projectParams }}</span>
        <UButton
          icon="i-heroicons-pencil"
          color="gray"
          variant="ghost"
          size="xs"
          :title="t('common.edit', 'Edit')"
          class="opacity-60 hover:opacity-100"
          @click="openProjectSettings"
        />
      </div>
    </PropertyRow>
  </PropertySection>
</template>
