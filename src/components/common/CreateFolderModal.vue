<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue'

const isOpen = defineModel<boolean>('open', { required: true })
const folderName = ref('')
const emit = defineEmits<{
  (e: 'create', name: string): void
}>()

const { t } = useI18n()

watch(isOpen, (val) => {
  if (val) folderName.value = ''
})

const handleCreate = () => {
  if (!folderName.value.trim()) return
  emit('create', folderName.value.trim())
  isOpen.value = false
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.actions.createFolder', 'Create Folder')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="space-y-4">
      <UFormField :label="t('common.name', 'Name')">
        <UInput
          v-model="folderName"
          :placeholder="t('videoEditor.fileManager.createFolder.placeholder', 'Folder name')"
          autofocus
          class="w-full"
          @keyup.enter="handleCreate"
        />
      </UFormField>
    </div>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="isOpen = false"
      >
        {{ t('common.cancel', 'Cancel') }}
      </UButton>
      <UButton
        color="primary"
        :disabled="!folderName.trim()"
        @click="handleCreate"
      >
        {{ t('common.create', 'Create') }}
      </UButton>
    </template>
  </AppModal>
</template>
