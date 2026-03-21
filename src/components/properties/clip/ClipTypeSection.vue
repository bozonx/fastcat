<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import { ref, computed } from 'vue';
import type { ShapeType, TimelineClipItem, TimelineTextClipItem, TimelineShapeClipItem, TimelineHudClipItem } from '~/timeline/types';
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
    const shapeClip = props.clip as TimelineShapeClipItem;
    const params = {
      shapeType: shapeClip.shapeType,
      fillColor: shapeClip.fillColor,
      strokeColor: shapeClip.strokeColor,
      strokeWidth: shapeClip.strokeWidth,
      shapeConfig: { ...(shapeClip.shapeConfig || {}) },
    };
    presetsStore.saveAsPreset('shape', params.shapeType ?? 'square', name, params);
  } else if (props.clip.clipType === 'hud') {
    const hudClip = props.clip as TimelineHudClipItem;
    const params = {
      hudType: hudClip.hudType,
      background: { ...(hudClip.background || {}) },
      content: { ...(hudClip.content || {}) },
    };
    presetsStore.saveAsPreset('hud', hudClip.hudType ?? 'media_frame', name, params);
  }

  isSaveModalOpen.value = false;
}

const shapePresets = computed(() =>
  presetsStore.customPresets
    .filter((p) => p.category === 'shape')
    .map((p) => ({ label: p.name, value: p.id, params: p.params })),
);

const hudPresets = computed(() =>
  presetsStore.customPresets
    .filter((p) => p.category === 'hud')
    .map((p) => ({ label: p.name, value: p.id, params: p.params })),
);

function handleLoadShapePreset(presetId: string) {
  const preset = presetsStore.customPresets.find((p) => p.id === presetId);
  if (!preset) return;

  const p = preset.params;
  if (p.shapeType) emit('updateShapeType', p.shapeType);
  if (p.fillColor) emit('updateFillColor', p.fillColor);
  if (p.strokeColor) emit('updateStrokeColor', p.strokeColor);
  if (p.strokeWidth !== undefined) emit('updateStrokeWidth', p.strokeWidth);
  if (p.shapeConfig) emit('updateShapeConfig', p.shapeConfig);
}

function handleLoadHudPreset(presetId: string) {
  const preset = presetsStore.customPresets.find((p) => p.id === presetId);
  if (!preset) return;

  const p = preset.params;
  // HUD presets might have background/content params
  if (p.background) {
    Object.entries(p.background).forEach(([key, val]) => {
      emit('updateHudControl', `background.${key}`, val);
    });
  }
  if (p.content) {
    Object.entries(p.content).forEach(([key, val]) => {
      emit('updateHudControl', `content.${key}`, val);
    });
  }
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
    :presets="shapePresets"
    @update-shape-type="emit('updateShapeType', $event)"
    @update-fill-color="emit('updateFillColor', $event)"
    @update-stroke-color="emit('updateStrokeColor', $event)"
    @update-stroke-width="emit('updateStrokeWidth', $event)"
    @update-shape-config="emit('updateShapeConfig', $event)"
    @open-save-preset-modal="openSavePresetModal"
    @load-preset="handleLoadShapePreset"
  />

  <ClipHudProperties
    v-else-if="props.clip.clipType === 'hud'"
    :clip="props.clip"
    :hud-manifest="props.hudManifest"
    :hud-control-values="props.hudControlValues"
    :presets="hudPresets"
    @update-hud-control="(key: string, val: unknown) => emit('updateHudControl', key, val)"
    @open-save-preset-modal="openSavePresetModal"
    @load-preset="handleLoadHudPreset"
  />
</template>
