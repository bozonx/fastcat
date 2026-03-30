<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  selectedFolderName: string;
  selectedFolderPath: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'upload', path?: string): void;
  (e: 'create-folder'): void;
  (e: 'create-timeline', path?: string): void;
  (e: 'create-text-file', path?: string): void;
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});
</script>

<template>
  <UiMobileDrawer v-model:open="isOpen" :title="t('common.create', 'Create')">
    <div class="flex flex-col gap-6 px-4 pt-2 pb-10">
      <!-- Block 1: Create in selected folder -->
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 px-1 opacity-60">
          <Icon name="lucide:folder" class="w-4 h-4" />
          <span class="text-xs font-semibold uppercase tracking-wider truncate">
            {{ t('common.createInFolder') }}: {{ selectedFolderName || '/' }}
          </span>
        </div>

        <div
          class="flex flex-col gap-1 bg-slate-800/30 rounded-2xl overflow-hidden border border-slate-800/50 p-1"
        >
          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
            @click="emit('upload')"
          >
            <div
              class="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:upload-cloud" class="w-5 h-5 text-indigo-400" />
            </div>
            <span class="text-sm font-medium text-slate-200">{{
              t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>

          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
            @click="emit('create-folder')"
          >
            <div
              class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:folder-plus" class="w-5 h-5 text-emerald-400" />
            </div>
            <span class="text-sm font-medium text-slate-200">{{
              t('videoEditor.fileManager.actions.createFolder', 'Create Folder')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>

          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
            @click="emit('create-text-file', selectedFolderPath)"
          >
            <div
              class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:file-text" class="w-5 h-5 text-blue-400" />
            </div>
            <span class="text-sm font-medium text-slate-200">{{
              t('common.textDocument', 'Text Document')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>

          <button
            class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
            @click="emit('create-timeline', selectedFolderPath)"
          >
            <div
              class="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
            >
              <Icon name="lucide:film" class="w-5 h-5 text-orange-400" />
            </div>
            <span class="text-sm font-medium text-slate-200">{{
              t('common.timeline', 'Timeline')
            }}</span>
            <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
          </button>
        </div>
      </div>

      <!-- Block 2: Global Actions (Default folders) -->
      <div class="flex flex-col gap-4 pt-2">
        <div class="flex items-center gap-2 px-1 opacity-60">
          <Icon name="lucide:layers" class="w-4 h-4" />
          <span class="text-xs font-semibold uppercase tracking-wider">{{
            t('common.quickCreateDefault')
          }}</span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <button
            class="col-span-2 flex items-center justify-center gap-4 p-4 rounded-2xl bg-primary-600/10 border border-primary-500/20 hover:bg-primary-600/20 active:scale-[0.98] transition-all group"
            @click="emit('upload', '')"
          >
            <Icon name="lucide:upload" class="w-6 h-6 text-primary-400" />
            <div class="flex flex-col items-start">
              <span class="font-bold text-primary-100 text-base leading-tight">{{
                t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files')
              }}</span>
              <span class="text-[10px] text-primary-400/80 font-medium tracking-tight uppercase">{{
                t('common.autoRecognition', 'Auto recognition')
              }}</span>
            </div>
          </button>

          <button
            class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
            @click="emit('create-timeline')"
          >
            <div
              class="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90"
            >
              <Icon name="lucide:film" class="w-6 h-6 text-orange-500" />
            </div>
            <span class="text-xs font-bold text-slate-200 uppercase tracking-tight">{{
              t('common.timeline', 'Timeline')
            }}</span>
            <span class="text-[10px] text-orange-400/60 font-medium leading-none">{{
              t('common.inDirTimelines')
            }}</span>
          </button>

          <button
            class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
            @click="emit('create-text-file')"
          >
            <div
              class="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90"
            >
              <Icon name="lucide:file-text" class="w-6 h-6 text-blue-500" />
            </div>
            <span
              class="text-xs font-bold text-slate-200 uppercase tracking-tight text-nowrap whitespace-nowrap overflow-hidden text-ellipsis w-full px-1"
              >{{ t('common.textDocument', 'Text Doc') }}</span
            >
            <span class="text-[10px] text-blue-400/60 font-medium leading-none">{{
              t('common.inDirDocuments')
            }}</span>
          </button>
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>
