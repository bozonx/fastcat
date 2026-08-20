<script setup lang="ts">
import { ref, watch } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import UiColorPicker from '~/components/ui/UiColorPicker.vue';

const open = defineModel<boolean>('open', { required: true });

defineProps<{
  portal?: boolean | string;
}>();

const emit = defineEmits<{
  (e: 'create', data: { text: string; color: string }): void;
}>();

const { t } = useI18n();

const text = ref('');
const color = ref('#eab308'); // default marker color

watch(open, (isOpen) => {
  if (isOpen) {
    text.value = '';
    color.value = '#eab308';
  }
});

function handleCreate() {
  emit('create', {
    text: text.value,
    color: color.value,
  });
  open.value = false;
}
</script>

<template>
  <UiModal v-model:open="open" :title="t('fastcat.timeline.addMarkerWithText')" :portal="portal">
    <div class="flex flex-col gap-4">
      <UiFormField :label="t('common.text')">
        <UiTextInput
          v-model="text"
          :placeholder="t('fastcat.timeline.addMarkerWithText')"
          autofocus
          full-width
          @keyup.enter="handleCreate"
        />
      </UiFormField>

      <UiFormField :label="t('common.color')">
        <UiColorPicker v-model="color" mode="marker" orientation="horizontal" size="sm" />
      </UiFormField>
    </div>
    <template #footer>
      <UButton variant="ghost" color="neutral" @click="void (open = false)">
        {{ t('common.cancel') }}
      </UButton>
      <UButton color="primary" @click="handleCreate">
        {{ t('common.create') }}
      </UButton>
    </template>
  </UiModal>
</template>
