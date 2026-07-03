<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { cloneValue } from '~/utils/clone';
import { usePresetsStore } from '~/stores/presets.store';
import { getHudManifest } from '~/hud/registry';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import ClipTextProperties from './clip/ClipTextProperties.vue';
import ClipShapeProperties from './clip/ClipShapeProperties.vue';
import ClipHudProperties from './clip/ClipHudProperties.vue';
import type { ShapeType, HudType } from '~/timeline/types';

import { useSelectionStore } from '~/stores/selection.store';
import type { PropertyAction } from '~/components/properties/PropertyActionList.vue';

const props = defineProps<{
  itemKind: 'text' | 'shape' | 'hud';
  itemId: string;
  presetParams?: Record<string, unknown>;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();
const selectionStore = useSelectionStore();

const params = ref<Record<string, unknown>>({});
const isSaveModalOpen = ref(false);
const isRenameModalOpen = ref(false);
const newPresetName = ref('');
const renamingPresetName = ref('');

const isRecentlySaved = ref(false);
let savedTimeout: number | null = null;

const isCustom = computed(() => props.itemId.startsWith('custom_'));

// Mock clip for sub-components
const mockClip = computed(() => {
  const base = {
    id: 'mock',
    trackId: 'mock',
    name: 'Mock',
    kind: 'clip' as const,
    clipType: props.itemKind as string,
    timelineRange: { startUs: 0, durationUs: 5000000 },
    sourceRange: { startUs: 0, durationUs: 5000000 },
  };

  if (props.itemKind === 'text') {
    return {
      ...base,
      text: params.value.text ?? t('fastcat.timeline.textClipDefaultText'),
      style: params.value.style ?? {},
    };
  } else if (props.itemKind === 'shape') {
    return {
      ...base,
      shapeType: (params.value.shapeType || props.itemId) as ShapeType,
      fillColor: params.value.fillColor ?? '#3b82f6',
      strokeColor: params.value.strokeColor ?? '#ffffff',
      strokeWidth: params.value.strokeWidth ?? 0,
      shapeConfig: params.value.shapeConfig ?? {},
    };
  } else if (props.itemKind === 'hud') {
    return {
      ...base,
      hudType: (params.value.hudType || props.itemId) as HudType,
      background: params.value.background ?? {},
      content: params.value.content ?? {},
      frame: params.value.frame ?? {},
    };
  }
  return base as import('~/timeline/types').TimelineClipItem;
});

const hudManifest = computed(() =>
  props.itemKind === 'hud'
    ? getHudManifest((params.value.hudType || props.itemId) as HudType)
    : null,
);

const hudControlValues = computed(() => {
  if (props.itemKind !== 'hud') return {};
  const clip = mockClip.value as import('~/timeline/types').TimelineHudClipItem;
  return {
    hudType: clip.hudType,
    ...flattenObject({ background: clip.background || {} }),
    ...flattenObject({ content: clip.content || {} }),
    ...flattenObject({ frame: clip.frame || {} }),
  };
});

function flattenObject(ob: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const i in ob) {
    if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;
    if (typeof ob[i] === 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
      const flatObject = flattenObject(ob[i] as Record<string, unknown>, prefix + i + '.');
      for (const x in flatObject) {
        if (!Object.prototype.hasOwnProperty.call(flatObject, x)) continue;
        result[x] = flatObject[x];
      }
    } else {
      result[prefix + i] = ob[i];
    }
  }
  return result;
}

watch(
  () => [props.itemKind, props.itemId, props.presetParams],
  () => {
    if (props.presetParams) {
      params.value = cloneValue(props.presetParams);
    } else {
      params.value = {};
    }
    isRecentlySaved.value = false;
    if (savedTimeout) {
      window.clearTimeout(savedTimeout);
      savedTimeout = null;
    }
  },
  { immediate: true },
);

function handleUpdateText(val: string) {
  params.value.text = val;
  isRecentlySaved.value = false;
}

function handleUpdateTextStyle(patch: Record<string, unknown>) {
  params.value.style = { ...(params.value.style || {}), ...patch };
  isRecentlySaved.value = false;
}

function handleUpdateShapeType(val: ShapeType) {
  params.value.shapeType = val;
  isRecentlySaved.value = false;
}

function handleUpdateShapeParam(key: string, val: unknown) {
  params.value[key] = val;
  isRecentlySaved.value = false;
}

function handleUpdateShapeConfig(patch: Record<string, unknown>) {
  params.value.shapeConfig = { ...(params.value.shapeConfig || {}), ...patch };
  isRecentlySaved.value = false;
}

function handleUpdateHudControl(key: string, value: unknown) {
  const keys = key.split('.');
  const layer = keys[0] as 'background' | 'content' | 'frame';
  if (!params.value[layer]) params.value[layer] = {};

  let target = params.value[layer] as Record<string, unknown>;
  for (let i = 1; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === undefined) continue;
    if (!target[k]) target[k] = {};
    target = target[k] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey !== undefined) {
    target[lastKey] = value;
  }
  isRecentlySaved.value = false;
}

function handleSavePreset() {
  if (!newPresetName.value.trim()) return;

  const baseType = isCustom.value
    ? presetsStore.customPresets.find((p) => p.id === props.itemId)?.baseType || props.itemId
    : props.itemId;

  presetsStore.saveAsPreset(props.itemKind, baseType, newPresetName.value.trim(), params.value);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}

function handleUpdatePreset() {
  if (!isCustom.value) return;
  presetsStore.updatePreset(props.itemId, params.value);

  isRecentlySaved.value = true;
  if (savedTimeout) window.clearTimeout(savedTimeout);
  savedTimeout = window.setTimeout(() => {
    isRecentlySaved.value = false;
  }, 1500);
}

function handleRenamePreset() {
  if (!isCustom.value || !renamingPresetName.value.trim()) return;
  presetsStore.renamePreset(props.itemId, renamingPresetName.value.trim());
  isRenameModalOpen.value = false;
}

function handleDeletePreset() {
  if (!isCustom.value) return;
  presetsStore.removePreset(props.itemId);
  selectionStore.clearSelection();
}

const actions = computed<PropertyAction[]>(() => {
  const list: PropertyAction[] = [];
  if (isCustom.value) {
    list.push({
      id: 'update-preset',
      label: isRecentlySaved.value ? t('common.saved') : t('common.save'),
      icon: isRecentlySaved.value ? 'i-heroicons-check-circle' : 'i-heroicons-check',
      color: isRecentlySaved.value ? 'success' : 'primary',
      onClick: handleUpdatePreset,
    });
  }
  list.push({
    id: 'save-as-preset',
    label: isCustom.value ? t('fastcat.effects.saveAsNew') : t('fastcat.effects.saveAsPreset'),
    icon: 'i-heroicons-bookmark',
    color: isCustom.value ? 'neutral' : 'primary',
    variant: isCustom.value ? 'soft' : 'solid',
    onClick: () => {
      newPresetName.value = '';
      isSaveModalOpen.value = true;
    },
  });
  if (isCustom.value) {
    list.push({
      id: 'rename-preset',
      icon: 'i-heroicons-pencil-square',
      color: 'neutral',
      variant: 'ghost',
      title: t('common.rename'),
      onClick: () => {
        const customItem = presetsStore.customPresets.find((p) => p.id === props.itemId);
        renamingPresetName.value = customItem?.name || '';
        isRenameModalOpen.value = true;
      },
    });
    list.push({
      id: 'delete-preset',
      icon: 'i-heroicons-trash',
      color: 'danger',
      variant: 'ghost',
      title: t('common.delete'),
      onClick: handleDeletePreset,
    });
  }
  return list;
});
</script>

<template>
  <div class="w-full flex flex-col gap-4 text-ui-text text-sm">
    <div class="flex items-center gap-2">
      <UIcon
        :name="
          itemKind === 'text'
            ? 'i-heroicons-document-text'
            : itemKind === 'shape'
              ? 'i-heroicons-stop'
              : 'i-heroicons-photo'
        "
        class="w-6 h-6 text-primary"
      />
      <span class="font-medium text-base">
        {{
          isCustom ? presetsStore.customPresets.find((p) => p.id === props.itemId)?.name : itemId
        }}
      </span>
    </div>

    <div class="space-y-3 bg-ui-bg border border-ui-border rounded p-3">
      <ClipTextProperties
        v-if="itemKind === 'text'"
        :clip="mockClip as import('~/timeline/types').TimelineTextClipItem"
        :presets="[]"
        :hide-presets="true"
        @update-text="handleUpdateText"
        @update-text-style="handleUpdateTextStyle"
      />

      <ClipShapeProperties
        v-else-if="itemKind === 'shape'"
        :clip="mockClip as import('~/timeline/types').TimelineShapeClipItem"
        :presets="[]"
        :hide-presets="true"
        @update-shape-type="handleUpdateShapeType"
        @update-fill-color="(val) => handleUpdateShapeParam('fillColor', val)"
        @update-stroke-color="(val) => handleUpdateShapeParam('strokeColor', val)"
        @update-stroke-width="(val) => handleUpdateShapeParam('strokeWidth', val)"
        @update-shape-config="handleUpdateShapeConfig"
      />

      <ClipHudProperties
        v-else-if="itemKind === 'hud'"
        :clip="mockClip as import('~/timeline/types').TimelineHudClipItem"
        :hud-manifest="hudManifest"
        :hud-control-values="hudControlValues"
        :presets="[]"
        :hide-presets="true"
        @update-hud-control="handleUpdateHudControl"
      />
    </div>

    <PropertyActionList :actions="actions" :vertical="false" size="sm" />

    <PresetSaveModal
      v-model:open="isSaveModalOpen"
      v-model:name="newPresetName"
      @save="handleSavePreset"
    />
    <PresetSaveModal
      v-model:open="isRenameModalOpen"
      v-model:name="renamingPresetName"
      :title="t('common.rename')"
      @save="handleRenamePreset"
    />
  </div>
</template>
