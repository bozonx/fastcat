<script setup lang="ts">
import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import SelectEffectModal from '~/components/common/SelectEffectModal.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import { getVideoEffectManifest } from '~/effects';
import type { VideoClipEffect } from '~/timeline/types';
import { usePresetsStore } from '~/stores/presets.store';

const props = defineProps<{
  effects?: VideoClipEffect[];
  title?: string;
  addLabel?: string;
  emptyLabel?: string;
}>();

const emit = defineEmits<{
  'update:effects': [effects: VideoClipEffect[]];
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isEffectModalOpen = ref(false);
const isSaveModalOpen = ref(false);
const newPresetName = ref('');
const savingEffectId = ref<string | null>(null);

const safeTitle = computed(() => props.title ?? t('fastcat.effects.title', 'Effects'));
const safeAddLabel = computed(() => props.addLabel ?? t('fastcat.effects.add', 'Add'));
const safeEmptyLabel = computed(
  () => props.emptyLabel ?? t('fastcat.effects.empty', 'No effects'),
);

const safeEffects = computed(() => props.effects ?? []);

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

function setEffects(next: VideoClipEffect[]) {
  emit('update:effects', next);
}

function handleAddEffect(type: string) {
  const manifest = getVideoEffectManifest(type);
  if (!manifest) return;

  const newEffect = {
    id: `effect_${Date.now()}`,
    type,
    enabled: true,
    target: 'video',
    ...manifest.defaultValues,
  } as VideoClipEffect;

  setEffects([...safeEffects.value, newEffect]);
}

function handleUpdateEffect(effectId: string, updates: Partial<VideoClipEffect>) {
  const next = safeEffects.value.map((e) =>
    e.id === effectId ? ({ ...e, ...updates } as VideoClipEffect) : e,
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

  const manifest = getVideoEffectManifest(effect.type);
  if (!manifest) return;

  const baseType = manifest.baseType || manifest.type;
  const paramsToSave = { ...effect };
  delete (paramsToSave as any).id;
  delete (paramsToSave as any).type;
  delete (paramsToSave as any).enabled;

  presetsStore.saveAsPreset('effect', baseType, newPresetName.value.trim(), paramsToSave);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
  savingEffectId.value = null;
}

function openSaveModal(effectId: string) {
  savingEffectId.value = effectId;
  isSaveModalOpen.value = true;
}

function handleUpdateEffectValue(effectId: string, key: string, value: any) {
  handleUpdateEffect(effectId, { [key]: value } as Partial<VideoClipEffect>);
}

function onUpdateOrder(newEffects: VideoClipEffect[]) {
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
      <span class="font-medium text-ui-text">{{ safeTitle }}</span>
      <UButton
        size="xs"
        variant="soft"
        color="primary"
        icon="i-heroicons-plus"
        @click="isEffectModalOpen = true"
      >
        {{ safeAddLabel }}
      </UButton>
    </div>

    <div v-if="safeEffects.length === 0" class="text-xs text-ui-text-muted text-center py-2">
      {{ safeEmptyLabel }}
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
            <span class="font-medium">{{
              getVideoEffectManifest(effect.type)?.name || effect.type
            }}</span>
          </div>
          <div class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="ghost"
              color="primary"
              icon="i-heroicons-bookmark"
              :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
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
            v-if="getVideoEffectManifest(effect.type)?.controls"
            :controls="getVideoEffectManifest(effect.type)?.controls ?? []"
            :values="effect as any"
            @update:value="(key, value) => handleUpdateEffectValue(effect.id, key, value)"
          />
        </div>
      </div>
    </VueDraggable>

    <SelectEffectModal v-model:open="isEffectModalOpen" @select="handleAddEffect" />

    <UModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('common.name', 'Name')">
            <UInput
              v-model="newPresetName"
              :placeholder="t('fastcat.effects.presetNamePlaceholder', 'My Custom Preset')"
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
