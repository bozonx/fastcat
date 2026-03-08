<script setup lang="ts">
import { computed, ref } from 'vue';
import SelectEffectModal from '~/components/common/SelectEffectModal.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import { getEffectManifest } from '~/effects';
import type { ClipEffect } from '~/timeline/types';
import { usePresetsStore } from '~/stores/presets.store';

const props = defineProps<{
  effects?: ClipEffect[];
  title?: string;
  addLabel?: string;
  emptyLabel?: string;
}>();

const emit = defineEmits<{
  'update:effects': [effects: ClipEffect[]];
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isEffectModalOpen = ref(false);
const isSaveModalOpen = ref(false);
const newPresetName = ref('');
const savingEffectId = ref<string | null>(null);

const safeTitle = computed(() => props.title ?? t('granVideoEditor.effects.title', 'Effects'));
const safeAddLabel = computed(() => props.addLabel ?? t('granVideoEditor.effects.add', 'Add'));
const safeEmptyLabel = computed(
  () => props.emptyLabel ?? t('granVideoEditor.effects.empty', 'No effects'),
);

const safeEffects = computed(() => props.effects ?? []);

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

function setEffects(next: ClipEffect[]) {
  emit('update:effects', next);
}

function handleAddEffect(type: string) {
  const manifest = getEffectManifest(type);
  if (!manifest) return;

  const newEffect = {
    id: `effect_${Date.now()}`,
    type,
    enabled: true,
    ...manifest.defaultValues,
  } as unknown as ClipEffect;

  setEffects([...safeEffects.value, newEffect]);
}

function handleUpdateEffect(effectId: string, updates: Partial<ClipEffect>) {
  const next = safeEffects.value.map((e) =>
    e.id === effectId ? ({ ...e, ...updates } as ClipEffect) : e,
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

  const manifest = getEffectManifest(effect.type);
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

    <div class="space-y-2">
      <div
        v-for="effect in safeEffects"
        :key="effect.id"
        class="bg-ui-bg border border-ui-border rounded p-3"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <USwitch
              :model-value="effect.enabled"
              size="sm"
              @update:model-value="handleUpdateEffect(effect.id, { enabled: $event })"
            />
            <span class="font-medium">{{
              getEffectManifest(effect.type)?.name || effect.type
            }}</span>
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

        <div class="space-y-3">
          <template
            v-for="control in getEffectManifest(effect.type)?.controls"
            :key="String(control.key)"
          >
            <div v-if="control.kind === 'slider'" class="flex flex-col gap-1">
              <div class="flex justify-between text-xs text-ui-text-muted">
                <span>{{ control.label }}</span>
                <span>
                  {{
                    control.format
                      ? control.format((effect as any)[control.key])
                      : (effect as any)[control.key]
                  }}
                </span>
              </div>
              <WheelSlider
                :model-value="(effect as any)[control.key]"
                :min="control.min"
                :max="control.max"
                :step="control.step"
                :default-value="getEffectManifest(effect.type)?.defaultValues?.[control.key as any]"
                @update:model-value="handleUpdateEffect(effect.id, { [control.key]: $event })"
              />
            </div>
            <div v-else-if="control.kind === 'toggle'" class="flex items-center justify-between">
              <span class="text-xs text-ui-text-muted">{{ control.label }}</span>
              <USwitch
                :model-value="(effect as any)[control.key]"
                size="sm"
                @update:model-value="handleUpdateEffect(effect.id, { [control.key]: $event })"
              />
            </div>
            <div v-else-if="control.kind === 'select'" class="flex flex-col gap-1">
              <span class="text-xs text-ui-text-muted">{{ control.label }}</span>
              <USelect
                :model-value="(effect as any)[control.key]"
                :items="control.options"
                size="sm"
                value-key="value"
                label-key="label"
                @update:model-value="handleUpdateEffect(effect.id, { [control.key]: $event })"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <SelectEffectModal v-model:open="isEffectModalOpen" @select="handleAddEffect" />

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
