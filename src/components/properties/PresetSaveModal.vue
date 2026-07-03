<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

// Shared "save as preset" dialog used by the effect/transition property
// editors (project-level and clip-level). Two-way bound to the host's
// open/name state; emits `save` on confirm or Enter.
const open = defineModel<boolean>('open', { required: true });
const name = defineModel<string>('name', { default: '' });

const emit = defineEmits<{ (e: 'save'): void }>();

defineProps<{
  title?: string;
}>();

const { t } = useI18n();
</script>

<template>
  <UiModal v-model:open="open" :title="title || t('fastcat.effects.savePresetTitle')">
    <div class="flex flex-col gap-4">
      <UiFormField :label="t('common.name')">
        <UiTextInput
          v-model="name"
          :placeholder="t('fastcat.effects.presetNamePlaceholder')"
          autofocus
          @keyup.enter="emit('save')"
        />
      </UiFormField>
    </div>
    <template #footer>
      <UButton variant="ghost" color="neutral" @click="void (open = false)">
        {{ t('common.cancel') }}
      </UButton>
      <UButton color="primary" :disabled="!name.trim()" @click="emit('save')">
        {{ t('common.save') }}
      </UButton>
    </template>
  </UiModal>
</template>
