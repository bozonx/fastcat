<script setup lang="ts">
import { computed } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import UiModal from '~/components/ui/UiModal.vue';

const props = defineProps<{
  trackId: string;
  itemId: string;
}>();

const emit = defineEmits<{
  (e: 'select', presetId: string): void;
  (e: 'close'): void;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isOpen = defineModel<boolean>('open', { default: false });

const standardPresets = [
  { id: 'default', name: t('fastcat.library.texts.default', 'Default'), icon: 'i-heroicons-document-text' },
  { id: 'title', name: t('fastcat.library.texts.title', 'Title'), icon: 'i-heroicons-h1' },
  { id: 'subtitle', name: t('fastcat.library.texts.subtitle', 'Subtitle'), icon: 'i-heroicons-h2' },
];

const customPresets = computed(() => {
  return presetsStore.customPresets
    .filter((p) => p.category === 'text')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

function selectPreset(id: string) {
  emit('select', id);
  isOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.library.texts.selectPreset', 'Select text preset')"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-6">
      <!-- Standard -->
      <div v-if="standardPresets.length > 0">
        <h3 class="text-sm font-medium text-ui-text-muted mb-3 px-1 uppercase tracking-wider">
          {{ t('fastcat.effects.groups.standard') }}
        </h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="p in standardPresets"
            :key="p.id"
            class="flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:bg-ui-bg-hover active:scale-95 border-ui-border bg-ui-bg-muted"
            @click="selectPreset(p.id)"
          >
            <UIcon :name="p.icon" class="w-8 h-8 text-primary shrink-0" />
            <span class="text-sm font-medium text-ui-text truncate">{{ p.name }}</span>
          </button>
        </div>
      </div>

      <!-- Custom -->
      <div v-if="customPresets.length > 0">
        <h3 class="text-sm font-medium text-ui-text-muted mb-3 px-1 uppercase tracking-wider">
          {{ t('fastcat.effects.groups.custom') }}
        </h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="p in customPresets"
            :key="p.id"
            class="flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:bg-ui-bg-hover active:scale-95 border-ui-border bg-ui-bg-muted"
            @click="selectPreset(p.id)"
          >
            <UIcon name="i-heroicons-document-text" class="w-8 h-8 text-primary shrink-0" />
            <span class="text-sm font-medium text-ui-text truncate">{{ p.name }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="standardPresets.length === 0 && customPresets.length === 0"
        class="py-8 text-center text-ui-text-muted italic"
      >
        {{ t('common.noData') }}
      </div>
    </div>
  </UiModal>
</template>
