<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import EffectSettingsModal from '~/components/common/EffectSettingsModal.vue';
import { getAllAudioEffectManifests, getAudioEffectManifest } from '~/effects';
import type { AudioEffectManifest } from '~/effects';
import type { AudioClipEffect } from '~/timeline/types';
import { usePresetsStore } from '~/stores/presets.store';

const props = defineProps<{
  effects?: AudioClipEffect[];
}>();

const emit = defineEmits<{
  'update:effects': [effects: AudioClipEffect[]];
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isSelectModalOpen = ref(false);
const isSaveModalOpen = ref(false);
const settingsEffectId = ref<string | null>(null);
const newPresetName = ref('');
const savingEffectId = ref<string | null>(null);

const safeEffects = computed(() => props.effects ?? []);

const availableEffects = computed(() => getAllAudioEffectManifests());
const basicEffects = computed(() =>
  availableEffects.value.filter(
    (effect) => !effect.isCustom && (effect.category ?? 'basic') === 'basic',
  ),
);
const artisticEffects = computed(() =>
  availableEffects.value.filter((effect) => !effect.isCustom && effect.category === 'artistic'),
);
const customEffects = computed(() => availableEffects.value.filter((effect) => effect.isCustom));

function hasEffects(effects: AudioEffectManifest<any>[]) {
  return effects.length > 0;
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('gran-effect')) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onDrop(e: DragEvent) {
  const effectType = e.dataTransfer?.getData('gran-effect');
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

function handleAction(effectId: string, action: string, key: string) {
  if (action === 'open-settings') {
    settingsEffectId.value = effectId;
  }
}

function onUpdateOrder(newEffects: AudioClipEffect[]) {
  setEffects(newEffects);
}
</script>

<template>
  <div
    class="space-y-3 mt-2 bg-ui-bg-elevated p-4 rounded border border-ui-border text-sm"
    @dragover="onDragOver"
    @drop="onDrop"
  >
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
          <div class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="ghost"
              color="primary"
              icon="i-heroicons-bookmark"
              :title="t('granVideoEditor.effects.saveAsPreset', 'Save as preset')"
              @click="openSaveModal(effect.id)"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="red"
              icon="i-heroicons-trash"
              @click="handleRemoveEffect(effect.id)"
            />
          </div>
        </div>

        <div class="space-y-3 pl-6">
          <ParamsRenderer
            v-if="getAudioEffectManifest(effect.type)?.controls"
            :controls="getAudioEffectManifest(effect.type)?.controls ?? []"
            :values="effect as any"
            @update:value="(key, value) => handleUpdateEffectValue(effect.id, key, value)"
            @action="(action, key) => handleAction(effect.id, action, key)"
          />
        </div>
      </div>
    </VueDraggable>

    <EffectSettingsModal
      v-if="settingsEffectId"
      :model-value="true"
      :effect="safeEffects.find(e => e.id === settingsEffectId)"
      :manifest="getAudioEffectManifest(safeEffects.find(e => e.id === settingsEffectId)?.type ?? '')"
      @update:model-value="(val) => { if (!val) settingsEffectId = null; }"
      @update:effect="(updates) => handleUpdateEffect(settingsEffectId!, updates)"
    />

    <SelectEffectModal v-model:open="isSelectModalOpen" target="audio" @select="handleAddEffect" />

    <UModal
      v-model:open="isSaveModalOpen"
      :title="t('granVideoEditor.effects.savePresetTitle', 'Save Preset')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('common.name', 'Name')">
            <UInput
              v-model="newPresetName"
              :placeholder="t('granVideoEditor.effects.presetNamePlaceholder', 'My Custom Preset')"
              autofocus
              @keyup.enter="handleSavePreset"
            />
          </UFormField>
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
    </UModal>
  </div>
</template>
