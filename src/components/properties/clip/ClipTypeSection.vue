<script setup lang="ts">
import { computed } from 'vue';
import type {
  ShapeType,
  TimelineClipItem,
  TimelineTextClipItem,
} from '~/timeline/types';
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
    @load-preset="handleLoadShapePreset"
  />

  <ClipHudProperties
    v-else-if="props.clip.clipType === 'hud'"
    :clip="props.clip"
    :hud-manifest="props.hudManifest"
    :hud-control-values="props.hudControlValues"
    :presets="hudPresets"
    @update-hud-control="(key: string, val: unknown) => emit('updateHudControl', key, val)"
    @load-preset="handleLoadHudPreset"
  />
</template>
