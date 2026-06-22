<script setup lang="ts">
import { computed } from 'vue';
import type {
  ShapeType,
  TimelineClipItem,
  TimelineTextClipItem,
} from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import { usePresetsStore } from '~/stores/presets.store';
import ClipTextProperties from './ClipTextProperties.vue';
import ClipShapeProperties from './ClipShapeProperties.vue';
import ClipHudProperties from './ClipHudProperties.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
  hideTextProperties?: boolean;
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

const textPresets = computed(() =>
  presetsStore.customPresets
    .filter((p) => p.category === 'text')
    .map((p) => ({ label: p.name, value: p.id, params: p.params })),
);

function handleLoadTextPreset(presetId: string) {
  const preset = presetsStore.customPresets.find((p) => p.id === presetId);
  if (!preset) return;

  const p = preset.params;
  if (p.style) emit('updateTextStyle', p.style as Record<string, unknown>);
}

function handleLoadShapePreset(presetId: string) {
  const preset = presetsStore.customPresets.find((p) => p.id === presetId);
  if (!preset) return;

  const p = preset.params;
  if (p.shapeType) emit('updateShapeType', p.shapeType as ShapeType);
  if (p.fillColor) emit('updateFillColor', p.fillColor as string);
  if (p.strokeColor) emit('updateStrokeColor', p.strokeColor as string);
  if (p.strokeWidth !== undefined) emit('updateStrokeWidth', p.strokeWidth as number);
  if (p.shapeConfig) emit('updateShapeConfig', p.shapeConfig as Record<string, unknown>);
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

function handleSavePreset() {
  newPresetName.value = props.clip.name || '';
  isSaveModalOpen.value = true;
}

function confirmSavePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;

  if (props.clip.clipType === 'text') {
    presetsStore.saveAsPreset('text', 'custom', name, {
      style: props.clip.style || {},
      text: props.clip.text,
    });
  } else if (props.clip.clipType === 'shape') {
    presetsStore.saveAsPreset('shape', props.clip.shapeType, name, {
      shapeType: props.clip.shapeType,
      fillColor: props.clip.fillColor,
      strokeColor: props.clip.strokeColor,
      strokeWidth: props.clip.strokeWidth,
      shapeConfig: props.clip.shapeConfig,
    });
  } else if (props.clip.clipType === 'hud') {
    presetsStore.saveAsPreset('hud', props.clip.hudType, name, {
      hudType: props.clip.hudType,
      background: props.clip.background,
      content: props.clip.content,
      frame: props.clip.frame,
    });
  }

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}
</script>

<template>
  <ClipTextProperties
    v-if="props.clip.clipType === 'text' && !props.hideTextProperties"
    :clip="props.clip as TimelineTextClipItem"
    :presets="textPresets"
    @update-text="emit('updateText', $event)"
    @update-text-style="emit('updateTextStyle', $event)"
    @load-preset="handleLoadTextPreset"
    @save-preset="handleSavePreset"
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
    @load-preset="handleLoadShapePreset"
    @save-preset="handleSavePreset"
  />

  <ClipHudProperties
    v-else-if="props.clip.clipType === 'hud'"
    :clip="props.clip"
    :hud-manifest="props.hudManifest"
    :hud-control-values="props.hudControlValues"
    :presets="hudPresets"
    @update-hud-control="(key: string, val: unknown) => emit('updateHudControl', key, val)"
    @load-preset="handleLoadHudPreset"
    @save-preset="handleSavePreset"
  />

  <UiModal v-model:open="isSaveModalOpen" :title="t('fastcat.effects.savePresetTitle')">
    <div class="flex flex-col gap-4">
      <UiFormField :label="t('common.name')">
        <UiTextInput
          v-model="newPresetName"
          :placeholder="t('fastcat.effects.presetNamePlaceholder')"
          autofocus
          @keyup.enter="confirmSavePreset"
        />
      </UiFormField>
    </div>
    <template #footer>
      <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
        {{ t('common.cancel') }}
      </UButton>
      <UButton color="primary" :disabled="!newPresetName.trim()" @click="confirmSavePreset">
        {{ t('common.save') }}
      </UButton>
    </template>
  </UiModal>
</template>
