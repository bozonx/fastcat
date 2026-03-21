<script setup lang="ts">
import { computed } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { formatBytes } from '~/utils/format';
import { useProjectSettingsStore } from '~/stores/project-settings.store';
import { useUiStore } from '~/stores/ui.store';

const props = defineProps<{
  isProjectRootDir: boolean;
  projectName: string | null | undefined;
  storageFreeBytes: number | null;
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
      v-if="props.storageFreeBytes !== null"
      :label="t('videoEditor.fileManager.projectRoot.freeSpace', 'Free space')"
      :value="formatBytes(props.storageFreeBytes)"
    />
    
    <div class="flex items-center justify-between text-xs px-2 py-1">
      <div class="flex flex-col gap-0.5">
        <span class="text-neutral-500">{{ t('videoEditor.fileManager.projectRoot.parameters', 'Parameters') }}</span>
        <span class="text-neutral-200">{{ projectParams }}</span>
      </div>
      <UButton
        icon="i-heroicons-pencil"
        color="gray"
        variant="ghost"
        size="sm"
        :title="t('common.edit', 'Edit')"
        @click="openProjectSettings"
      />
    </div>
  </PropertySection>
</template>
