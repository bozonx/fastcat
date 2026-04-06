<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import EffectSettingsModal from '~/components/effects/EffectSettingsModal.vue';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import { getAllAudioEffectManifests, getAudioEffectManifest } from '~/effects';
import type { AudioEffectManifest } from '~/effects';
import type { AudioClipEffect } from '~/timeline/types';
import { usePresetsStore } from '~/stores/presets.store';

const props = defineProps<{
  effects?: AudioClipEffect[];
  hasToggle?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:effects': [effects: AudioClipEffect[]];
}>();

const modelValue = defineModel<boolean>('toggleValue');

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isSelectModalOpen = ref(false);
const isSaveModalOpen = ref(false);
const settingsEffectId = ref<string | null>(null);
const newPresetName = ref('');
const savingEffectId = ref<string | null>(null);

const safeEffects = computed(() => props.effects ?? []);
const effectsWithManifest = computed(() =>
  safeEffects.value.map((effect) => ({
    effect,
    manifest: getAudioEffectManifest(effect.type),
  })),
);
const activeSettingsEffect = computed(
  () => safeEffects.value.find((effect) => effect.id === settingsEffectId.value) ?? null,
);
const activeSettingsManifest = computed(() => {
  if (!activeSettingsEffect.value) return null;
  return getAudioEffectManifest(activeSettingsEffect.value.type);
});

const availableEffects = computed(() => getAllAudioEffectManifests());
const basicEffects = computed(() =>
  availableEffects.value.filter(
    (effect) => !effect.isCustom && (effect.category ?? 'basic') === 'basic',
  ),
);
const nonBasicEffects = computed(() =>
  availableEffects.value.filter(
    (effect) => !effect.isCustom && (effect.category ?? 'basic') !== 'basic',
  ),
);
const customEffects = computed(() => availableEffects.value.filter((effect) => effect.isCustom));

function hasEffects(effects: AudioEffectManifest<any>[]) {
  return effects.length > 0;
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('fastcat-effect')) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onDrop(e: DragEvent) {
  const effectType = e.dataTransfer?.getData('fastcat-effect');
  if (!effectType) return;
  e.preventDefault();
  e.stopPropagation();
  handleAddEffect(effectType);
}

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

function handleSavePreset() {
  if (!savingEffectId.value || !newPresetName.value.trim()) return;

  const effect = safeEffects.value.find((e) => e.id === savingEffectId.value);
  if (!effect) return;

  const manifest = getAudioEffectManifest(effect.type);
  if (!manifest) return;

  const baseType = manifest.baseType || manifest.type;
  const paramsToSave = { ...effect };
  delete (paramsToSave as any).id;
  delete (paramsToSave as any).type;
  delete (paramsToSave as any).enabled;
  delete (paramsToSave as any).target;

  presetsStore.saveAsPreset('effect', baseType, newPresetName.value.trim(), paramsToSave, 'audio');

  isSaveModalOpen.value = false;
  newPresetName.value = '';
  savingEffectId.value = null;
}

function openSaveModal(effectId: string) {
  savingEffectId.value = effectId;
  isSaveModalOpen.value = true;
}

function handleUpdateEffectValue(effectId: string, key: string, value: unknown) {
  handleUpdateEffect(effectId, { [key]: value } as Partial<AudioClipEffect>);
}

function handleAction(effectId: string, action: string, _key: string) {
  if (action === 'open-settings') {
    settingsEffectId.value = effectId;
  }
}

function onUpdateOrder(newEffects: AudioClipEffect[]) {
  setEffects(newEffects);
}
</script>

<template>
  <PropertySection
    v-model:toggle-value="modelValue"
    :title="t('fastcat.effects.audioTitle', 'Audio effects')"
    class="mt-2"
    :has-toggle="props.hasToggle"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <template #header-actions>
      <UButton
        size="xs"
        variant="soft"
        color="primary"
        icon="i-heroicons-plus"
        :disabled="props.disabled"
        @click="isSelectModalOpen = true"
      >
        {{ t('fastcat.effects.add', 'Add') }}
      </UButton>
    </template>

    <div class="space-y-2 py-1">
      <div
        v-if="safeEffects.length === 0"
        class="text-xs text-ui-text-muted text-center py-2"
        :class="{ 'opacity-50': props.disabled }"
      >
        {{ t('fastcat.effects.empty', 'No effects') }}
      </div>

      <VueDraggable
        class="space-y-2"
        :model-value="safeEffects"
        handle=".drag-handle"
        :animation="150"
        :disabled="props.disabled"
        @update:model-value="onUpdateOrder"
      >
        <div
          v-for="{ effect, manifest } in effectsWithManifest"
          :key="effect.id"
          class="bg-ui-bg border border-ui-border rounded px-2 py-2"
          :class="{ 'opacity-50 pointer-events-none': props.disabled }"
        >
          <div class="flex items-center w-full gap-2 mb-1">
            <UIcon
              name="i-heroicons-bars-2"
              class="drag-handle w-4 h-4 text-ui-text-muted hover:text-ui-text cursor-grab active:cursor-grabbing shrink-0"
            />
            <USwitch
              :model-value="effect.enabled"
              size="sm"
              class="shrink-0"
              :disabled="props.disabled"
              @update:model-value="handleUpdateEffect(effect.id, { enabled: $event })"
            />
            <span class="font-medium flex-1 truncate">
              {{ manifest?.name || effect.type }}
            </span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                size="xs"
                variant="ghost"
                color="primary"
                icon="i-heroicons-bookmark"
                :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
                :disabled="props.disabled"
                @click="openSaveModal(effect.id)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-trash"
                :disabled="props.disabled"
                @click="handleRemoveEffect(effect.id)"
              />
            </div>
          </div>

          <div class="mt-1 pl-1">
            <ParamsRenderer
              v-if="manifest?.controls"
              :controls="manifest?.controls ?? []"
              :values="effect as any"
              :disabled="props.disabled || !effect.enabled"
              @update:value="
                (key: any, value: any) => handleUpdateEffectValue(effect.id, key, value)
              "
              @action="(action: any, key: any) => handleAction(effect.id, action, key)"
            />
          </div>
        </div>
      </VueDraggable>
    </div>

    <EffectSettingsModal
      v-if="settingsEffectId"
      :model-value="true"
      :effect="activeSettingsEffect"
      :manifest="activeSettingsManifest"
      @update:model-value="
        (val) => {
          if (!val) settingsEffectId = null;
        }
      "
      @update:effect="(updates) => handleUpdateEffect(settingsEffectId!, updates)"
    />

    <SelectEffectModal v-model:open="isSelectModalOpen" target="audio" @select="handleAddEffect" />

    <UiModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UiFormField :label="t('common.name', 'Name')">
            <UInput
              v-model="newPresetName"
              :placeholder="t('fastcat.effects.presetNamePlaceholder', 'My Custom Preset')"
              autofocus
              @keyup.enter="handleSavePreset"
            />
          </UiFormField>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
              {{ t('common.cancel', 'Cancel') }}
            </UButton>
            <UButton color="primary" :disabled="!newPresetName.trim()" @click="handleSavePreset">
              {{ t('common.save', 'Save') }}
            </UButton>
          </div>
        </div>
      </template>
    </UiModal>
  </PropertySection>
</template>
