<script setup lang="ts">
import { Splitpanes, Pane } from 'splitpanes';
import FileManager from '~/components/FileManager.vue';
import PropertiesPanel from '~/components/PropertiesPanel.vue';
import { useFilesPageStore } from '~/stores/filesPage.store';

const filesPageStore = useFilesPageStore();
const { t } = useI18n();
</script>

<template>
  <ClientOnly>
    <Splitpanes class="flex-1 min-h-0 editor-splitpanes">
      <Pane min-size="10">
        <FileManager folders-only class="h-full" @select="filesPageStore.selectFolder" />
      </Pane>
      <Pane min-size="10">
        <div
          class="h-full bg-ui-bg-elevated/50 p-4 border border-ui-border rounded flex flex-col items-center justify-center text-ui-text-muted"
        >
          <h3 class="font-bold mb-2">
            {{ t('videoEditor.fileManager.empty', 'Central Panel - coming soon') }}
          </h3>
        </div>
      </Pane>
      <Pane min-size="10">
        <PropertiesPanel :entity="filesPageStore.selectedEntity" class="h-full" />
      </Pane>
    </Splitpanes>
  </ClientOnly>
</template>
