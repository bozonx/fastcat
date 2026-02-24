<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { getAllEffectManifests } from '~/effects';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  select: [effectType: string];
}>();

const isOpen = ref(props.open);

watch(
  () => props.open,
  (val) => {
    isOpen.value = val;
  },
);

watch(isOpen, (val) => {
  if (val !== props.open) {
    emit('update:open', val);
  }
});

const effects = computed(() => getAllEffectManifests());

function handleSelect(type: string) {
  emit('select', type);
  isOpen.value = false;
}
</script>

<template>
  <UModal v-model:open="isOpen" :title="'Добавить эффект'">
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-2">
          <div
            v-for="effect in effects"
            :key="effect.type"
            class="flex items-start gap-3 p-3 rounded-lg border border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated cursor-pointer transition-colors"
            @click="handleSelect(effect.type)"
          >
            <UIcon :name="effect.icon" class="w-8 h-8 text-primary shrink-0" />
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium text-ui-text">{{ effect.name }}</h4>
              <p class="text-xs text-ui-text-muted mt-1">{{ effect.description }}</p>
            </div>
            <UIcon name="i-heroicons-plus-circle" class="w-5 h-5 text-ui-text-muted" />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">Отмена</UButton>
      </div>
    </template>
  </UModal>
</template>
