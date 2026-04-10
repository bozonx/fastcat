<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';

interface TimelineRef {
  timelineName: string;
  timelinePath: string;
}

interface Props {
  deleteTargets: FsEntry[];
  timelinesUsingDeleteTarget: TimelineRef[];
  isDeleteConfirmModalOpen: boolean;
  transcriptionModalOpen: boolean;
  isTranscribing: boolean;
  transcriptionError: string;
  transcriptionEntry: FsEntry | null;
  transcriptionLanguage: string;
  // Creation modal
  isFolderModalOpen: boolean;
  folderDefaultName: string;
  // BloggerDog Creation
  isSubgroupModalOpen: boolean;
  isItemModalOpen: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:isDeleteConfirmModalOpen', value: boolean): void;
  (e: 'update:transcriptionModalOpen', value: boolean): void;
  (e: 'update:transcriptionLanguage', value: string): void;
  (e: 'update:isFolderModalOpen', value: boolean): void;
  (e: 'update:isSubgroupModalOpen', value: boolean): void;
  (e: 'update:isItemModalOpen', value: boolean): void;
  (e: 'deleteConfirm'): void;
  (e: 'submitTranscription'): void;
  (e: 'folderConfirm', name: string): void;
  (e: 'subgroupConfirm', name: string): void;
  (e: 'itemConfirm', name: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <UiConfirmModal
    :open="props.isDeleteConfirmModalOpen"
    :title="t('common.delete', 'Delete')"
    :description="
      t(
        'common.confirmDelete',
        'Are you sure you want to delete this? This action cannot be undone.',
      )
    "
    color="error"
    icon="i-heroicons-exclamation-triangle"
    @update:open="emit('update:isDeleteConfirmModalOpen', $event)"
    @confirm="emit('deleteConfirm')"
  >
    <div>
      <div v-if="props.deleteTargets.length === 1" class="mt-2 text-sm font-medium text-ui-text">
        {{ props.deleteTargets[0]?.name }}
      </div>
      <div v-else-if="props.deleteTargets.length > 1" class="mt-2 text-sm font-medium text-ui-text">
        {{ props.deleteTargets.length }} {{ t('common.itemsSelected', 'items selected') }}
      </div>
      <div
        v-if="props.deleteTargets.length === 1 && props.deleteTargets[0]?.path"
        class="mt-1 text-xs text-ui-text-muted break-all"
      >
        {{
          props.deleteTargets[0].kind === 'directory'
            ? t('common.folder', 'Folder')
            : t('common.file', 'File')
        }}
        ·
        {{ props.deleteTargets[0].path }}
      </div>

      <div
        v-if="props.timelinesUsingDeleteTarget.length > 0"
        class="mt-3 p-2 rounded border border-red-500/40 bg-red-500/10"
      >
        <div class="text-xs font-semibold text-red-400">
          {{ t('videoEditor.fileManager.delete.usedWarning', 'This file is used in timelines:') }}
        </div>
        <div class="mt-1 flex flex-col gap-1">
          <div
            v-for="tl in props.timelinesUsingDeleteTarget"
            :key="tl.timelinePath"
            class="text-xs text-ui-text break-all"
          >
            {{ tl.timelineName }}
            <span class="text-2xs text-ui-text-muted">({{ tl.timelinePath }})</span>
          </div>
        </div>
      </div>
    </div>
  </UiConfirmModal>

  <UiModal
    :open="props.transcriptionModalOpen"
    :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
    :close-button="!props.isTranscribing"
    :prevent-close="props.isTranscribing"
    :ui="{ content: 'sm:max-w-lg', body: 'overflow-y-auto' }"
    @update:open="emit('update:transcriptionModalOpen', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="text-sm text-ui-text-muted">
        {{
          t(
            'videoEditor.fileManager.audio.transcriptionHint',
            'Send the current audio file to the configured STT service. Language is optional.',
          )
        }}
      </div>

      <div v-if="props.transcriptionEntry" class="text-xs text-ui-text-muted break-all">
        {{ props.transcriptionEntry.name }}
      </div>

      <UiFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
        <UiTextInput
          :model-value="props.transcriptionLanguage"
          :disabled="props.isTranscribing"
          placeholder="en"
          full-width
          @update:model-value="emit('update:transcriptionLanguage', $event)"
        />
      </UiFormField>

      <div v-if="props.transcriptionError" class="text-sm text-error-400">
        {{ props.transcriptionError }}
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="props.isTranscribing"
          @click="emit('update:transcriptionModalOpen', false)"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          :loading="props.isTranscribing"
          @click="emit('submitTranscription')"
        >
          {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
        </UButton>
      </div>
    </template>
  </UiModal>

  <UiEntityCreationModal
    :open="props.isFolderModalOpen"
    :title="t('videoEditor.fileManager.actions.createFolder', 'Create folder')"
    :default-value="props.folderDefaultName"
    @update:open="emit('update:isFolderModalOpen', $event)"
    @confirm="emit('folderConfirm', $event)"
  />

  <UiEntityCreationModal
    :open="props.isSubgroupModalOpen"
    :title="t('fastcat.bloggerDog.actions.createSubgroup', 'Create subgroup')"
    @update:open="emit('update:isSubgroupModalOpen', $event)"
    @confirm="emit('subgroupConfirm', $event)"
  />

  <UiEntityCreationModal
    :open="props.isItemModalOpen"
    :title="t('fastcat.bloggerDog.actions.createItem', 'Create content item')"
    @update:open="emit('update:isItemModalOpen', $event)"
    @confirm="emit('itemConfirm', $event)"
  />
</template>
