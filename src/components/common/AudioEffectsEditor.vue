<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import { getAllAudioEffectManifests, getAudioEffectManifest } from '~/effects';
import type { AudioClipEffect } from '~/timeline/types';

const props = defineProps<{
  effects?: AudioClipEffect[];
}>();

const emit = defineEmits<{
  'update:effects': [effects: AudioClipEffect[]];
}>();

const { t } = useI18n();

const isSelectModalOpen = ref(false);

const safeEffects = computed(() => props.effects ?? []);

const availableEffects = computed(() => getAllAudioEffectManifests());

function setEffects(next: AudioClipEffect[]) {
  emit('update:effects', next);
}

function handleAddEffect(type: string) {
  const manifest = getAudioEffectManifest(type);
  if (!manifest) return;

  const newEffect: AudioClipEffect = {
    id: `audio_effect_${Date.now()}`,
    type,
    enabled: true,
    target: 'audio',
    ...manifest.defaultValues,
  };

  setEffects([...safeEffects.value, newEffect]);
  isSelectModalOpen.value = false;
}

function handleUpdateEffect(effectId: string, updates: Partial<AudioClipEffect>) {
  const next = safeEffects.value.map((e) =>
    e.id === effectId ? ({ ...e, ...updates } as AudioClipEffect) : e,
  );
  setEffects(next);
}

function handleRemoveEffect(effectId: string) {
  setEffects(safeEffects.value.filter((e) => e.id !== effectId));
}

function handleUpdateEffectValue(effectId: string, key: string, value: unknown) {
  handleUpdateEffect(effectId, { [key]: value } as Partial<AudioClipEffect>);
}

function onUpdateOrder(newEffects: AudioClipEffect[]) {
  setEffects(newEffects);
}
</script>

<template>
  <div class="space-y-3 mt-2 bg-ui-bg-elevated p-4 rounded border border-ui-border text-sm">
    <div class="flex items-center justify-between">
      <span class="font-medium text-ui-text">
        {{ t('granVideoEditor.effects.audioTitle', 'Audio effects') }}
      </span>
      <UButton
        size="xs"
        variant="soft"
        color="primary"
        icon="i-heroicons-plus"
        @click="isSelectModalOpen = true"
      >
        {{ t('granVideoEditor.effects.add', 'Add') }}
      </UButton>
    </div>

    <div v-if="safeEffects.length === 0" class="text-xs text-ui-text-muted text-center py-2">
      {{ t('granVideoEditor.effects.empty', 'No effects') }}
    </div>

    <VueDraggable
      class="space-y-2"
      :model-value="safeEffects"
      handle=".drag-handle"
      :animation="150"
      @update:model-value="onUpdateOrder"
    >
      <div
        v-for="effect in safeEffects"
        :key="effect.id"
        class="bg-ui-bg border border-ui-border rounded p-3"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-heroicons-bars-2"
              class="drag-handle w-4 h-4 text-ui-text-muted hover:text-ui-text cursor-grab active:cursor-grabbing shrink-0"
            />
            <USwitch
              :model-value="effect.enabled"
              size="sm"
              @update:model-value="handleUpdateEffect(effect.id, { enabled: $event })"
            />
            <span class="font-medium">
              {{ getAudioEffectManifest(effect.type)?.name || effect.type }}
            </span>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="red"
            icon="i-heroicons-trash"
            @click="handleRemoveEffect(effect.id)"
          />
        </div>

        <div class="space-y-3 pl-6">
          <ParamsRenderer
            v-if="getAudioEffectManifest(effect.type)?.controls"
            :controls="getAudioEffectManifest(effect.type)?.controls ?? []"
            :values="effect as any"
            @update:value="(key, value) => handleUpdateEffectValue(effect.id, key, value)"
          />
        </div>
      </div>
    </VueDraggable>

    <UModal
      v-model:open="isSelectModalOpen"
      :title="t('granVideoEditor.effects.addAudioEffect', 'Add audio effect')"
    >
      <template #body>
        <div class="grid grid-cols-1 gap-2">
          <div
            v-for="manifest in availableEffects"
            :key="manifest.type"
            class="flex items-start gap-3 p-3 rounded-lg border border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated cursor-pointer transition-colors"
            @click="handleAddEffect(manifest.type)"
          >
            <UIcon :name="manifest.icon" class="w-8 h-8 text-primary shrink-0" />
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium text-ui-text">{{ manifest.name }}</h4>
              <p class="text-xs text-ui-text-muted mt-1">{{ manifest.description }}</p>
            </div>
            <UIcon name="i-heroicons-plus-circle" class="w-5 h-5 text-ui-text-muted" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isSelectModalOpen = false">
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
