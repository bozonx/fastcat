<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { ref } from 'vue';
import type { ShapeType, TimelineClipItem, TimelineTextClipItem } from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import { usePresetsStore } from '~/stores/presets.store';
import ClipBackgroundProperties from './ClipBackgroundProperties.vue';
import ClipTextProperties from './ClipTextProperties.vue';
import ClipShapeProperties from './ClipShapeProperties.vue';
import ClipHudProperties from './ClipHudProperties.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'updateBackgroundColor', val: string): void;
  (e: 'updateText', val: string): void;
  (e: 'updateTextStyle', patch: Record<string, unknown>): void;
  (e: 'updateShapeType', val: ShapeType): void;
  (e: 'updateFillColor', val: string): void;
  (e: 'updateStrokeColor', val: string): void;
  (e: 'updateStrokeWidth', val: number): void;
  (e: 'updateShapeConfig', patch: Record<string, unknown>): void;
  (e: 'updateHudControl', key: string, value: unknown): void;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isSaveModalOpen = ref(false);
const newPresetName = ref('');

function openSavePresetModal() {
  newPresetName.value = '';
  isSaveModalOpen.value = true;
}

function handleSavePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;

  if (props.clip.clipType === 'shape') {
    const params = {
      shapeType: (props.clip as any).shapeType,
      fillColor: (props.clip as any).fillColor,
      strokeColor: (props.clip as any).strokeColor,
      strokeWidth: (props.clip as any).strokeWidth,
      shapeConfig: { ...((props.clip as any).shapeConfig || {}) },
    };
    presetsStore.saveAsPreset('shape', params.shapeType ?? 'square', name, params);
  } else if (props.clip.clipType === 'hud') {
    const params = {
      hudType: (props.clip as any).hudType,
      background: { ...((props.clip as any).background || {}) },
      content: { ...((props.clip as any).content || {}) },
    };
    presetsStore.saveAsPreset('hud', params.hudType ?? 'media_frame', name, params);
  }

  isSaveModalOpen.value = false;
}
</script>

<template>
  <UiModal
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
  </UiModal>

  <ClipBackgroundProperties
    v-if="props.clip.clipType === 'background'"
    :clip="props.clip"
    @update-background-color="emit('updateBackgroundColor', $event)"
  />

  <ClipTextProperties
    v-else-if="props.clip.clipType === 'text'"
    :clip="props.clip as TimelineTextClipItem"
    @update-text="emit('updateText', $event)"
    @update-text-style="emit('updateTextStyle', $event)"
  />

  <ClipShapeProperties
    v-else-if="props.clip.clipType === 'shape'"
    :clip="props.clip"
    @update-shape-type="emit('updateShapeType', $event)"
    @update-fill-color="emit('updateFillColor', $event)"
    @update-stroke-color="emit('updateStrokeColor', $event)"
    @update-stroke-width="emit('updateStrokeWidth', $event)"
    @update-shape-config="emit('updateShapeConfig', $event)"
    @open-save-preset-modal="openSavePresetModal"
  />

  <ClipHudProperties
    v-else-if="props.clip.clipType === 'hud'"
    :clip="props.clip"
    :hud-manifest="props.hudManifest"
    :hud-control-values="props.hudControlValues"
    @update-hud-control="(key: string, val: unknown) => emit('updateHudControl', key, val)"
  />
</template>
