<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '~/components/ui/AppModal.vue'

const props = defineProps<{
  initialName?: string
}>()

const isOpen = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  (e: 'rename', newName: string): void
}>()

const { t } = useI18n()
const name = ref('')

watch(isOpen, (val) => {
  if (val) {
    name.value = props.initialName ?? ''
  }
})

const handleRename = () => {
  const trimmed = name.value.trim()
  if (trimmed && trimmed !== props.initialName) {
    emit('rename', trimmed)
  }
  isOpen.value = false
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('common.rename', 'Rename')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="space-y-4">
      <UFormField :label="t('common.name', 'Name')">
        <UInput
          v-model="name"
          autofocus
          class="w-full"
          @keyup.enter="handleRename"
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
        :disabled="!name.trim() || name.trim() === initialName"
        @click="handleRename"
      >
        {{ t('common.save', 'Save') }}
      </UButton>
    </template>
  </AppModal>
</template>
