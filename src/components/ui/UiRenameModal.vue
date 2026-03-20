<script setup lang="ts">

import UiModal from '~/components/ui/UiModal.vue';

const props = defineProps<{
  open: boolean;
  title?: string;
  initialName?: string;
  currentName?: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'rename', newName: string): void;
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (val) => emit('update:open', val),
});

const name = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  (val) => {
    if (val) {
      name.value = props.initialName ?? props.currentName ?? '';
      nextTick(() => {
        if (inputRef.value) {
          inputRef.value.focus();
          inputRef.value.select();
        }
      });
    }
  },
);

function handleSubmit() {
  const trimmed = name.value.trim();
  if (!trimmed) return;

  emit('rename', trimmed);
  isOpen.value = false;
}
</script>

<template>
  <UiModal v-model:open="isOpen" :title="title || t('common.rename', 'Rename')">
    <form class="ui-section" @submit.prevent="handleSubmit">
      <UFormField :label="t('common.name', 'Name')">
        <UInput
          ref="inputRef"
          v-model="name"
          class="w-full"
          data-primary-focus="true"
          :placeholder="t('common.namePlaceholder', 'Enter name...')"
        />
      </UFormField>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" :disabled="!name.trim()" @click="handleSubmit">
          {{ t('common.save', 'Save') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
