<script setup lang="ts">
import { computed } from 'vue';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  modelValue: boolean;
  selectedFolderName: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'upload', path?: string): void;
  (e: 'upload-global'): void;
  (e: 'create-folder'): void;
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});
</script>

<template>
  <UiMobileDrawer v-model:open="isOpen" :title="t('common.create')">
    <div class="flex flex-col gap-6 px-4 pt-2 pb-10">
      <!-- Block 1: Create in selected folder -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 px-1 opacity-60">
          <Icon name="lucide:folder" class="w-4 h-4" />
          <span class="text-xs font-semibold tracking-wider truncate">
            {{ t('common.createInFolder') }}: {{ selectedFolderName || '/' }}
          </span>
        </div>

        <div
          class="flex flex-col gap-1 bg-ui-bg-muted/30 rounded-2xl overflow-hidden border border-ui-border/50 p-1"
        >
          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-ui-bg-elevated/40 transition-colors group text-left"
            @click="emit('upload')"
          >
            <div
              class="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:upload-cloud" class="w-5 h-5 text-indigo-400" />
            </div>
            <span class="text-sm font-medium text-ui-text">{{
              t('videoEditor.fileManager.actions.uploadFiles')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>

          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-ui-bg-elevated/40 transition-colors group text-left"
            @click="emit('create-folder')"
          >
            <div
              class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:folder-plus" class="w-5 h-5 text-emerald-400" />
            </div>
            <span class="text-sm font-medium text-ui-text">{{
              t('videoEditor.fileManager.actions.createFolder')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>
        </div>
      </div>

      <!-- Block 2: Global Actions (Default folders) -->
      <div class="flex flex-col gap-4 pt-2">
        <div class="flex items-center gap-2 px-1 opacity-60">
          <Icon name="lucide:layers" class="w-4 h-4" />
          <span class="text-xs font-semibold tracking-wider">{{
            t('common.quickCreateDefault')
          }}</span>
        </div>

        <div
          class="flex flex-col gap-1 bg-ui-bg-muted/30 rounded-2xl overflow-hidden border border-ui-border/50 p-1"
        >
          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-ui-bg-elevated/40 transition-colors group text-left"
            @click="emit('upload-global')"
          >
            <div
              class="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:folder-up" class="w-5 h-5 text-violet-400" />
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-medium text-ui-text">{{
                t('videoEditor.fileManager.actions.uploadWithAutoDetect')
              }}</span>
              <span class="text-xs text-violet-400/70 font-medium">{{
                t('common.autoDetectFolder')
              }}</span>
            </div>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>
