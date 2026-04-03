<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import { getHudManifest } from '~/hud/registry';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import ClipTextProperties from './clip/ClipTextProperties.vue';
import ClipShapeProperties from './clip/ClipShapeProperties.vue';
import ClipHudProperties from './clip/ClipHudProperties.vue';
import type { TimelineClipItem, ShapeType, HudType } from '~/timeline/types';

const props = defineProps<{
  itemKind: 'text' | 'shape' | 'hud';
  itemId: string;
  presetParams?: any;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const params = ref<Record<string, any>>({});
const isSaveModalOpen = ref(false);
const newPresetName = ref('');

const isCustom = computed(() => props.itemId.startsWith('custom_'));

// Mock clip for sub-components
const mockClip = computed(() => {
  const base = {
    id: 'mock',
    trackId: 'mock',
    name: 'Mock',
    kind: 'clip' as const,
    clipType: props.itemKind as any,
    timelineRange: { startUs: 0, durationUs: 5000000 },
    sourceRange: { startUs: 0, durationUs: 5000000 },
  };

  if (props.itemKind === 'text') {
    return {
      ...base,
      text: params.value.text ?? t('fastcat.timeline.textClipDefaultText', 'Text'),
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
  return base as any;
});

const hudManifest = computed(() =>
  props.itemKind === 'hud' ? getHudManifest((params.value.hudType || props.itemId) as HudType) : null,
);

const hudControlValues = computed(() => {
  if (props.itemKind !== 'hud') return {};
  const clip = mockClip.value;
  return {
    hudType: clip.hudType,
    ...flattenObject({ background: clip.background || {} }),
    ...flattenObject({ content: clip.content || {} }),
    ...flattenObject({ frame: clip.frame || {} }),
  };
});

function flattenObject(ob: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};
  for (const i in ob) {
    if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;
    if (typeof ob[i] === 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
      const flatObject = flattenObject(ob[i], prefix + i + '.');
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
      params.value = JSON.parse(JSON.stringify(props.presetParams));
    } else {
      params.value = {};
    }
  },
  { immediate: true },
);

function handleUpdateText(val: string) {
  params.value.text = val;
}

function handleUpdateTextStyle(patch: Record<string, any>) {
  params.value.style = { ...(params.value.style || {}), ...patch };
}

function handleUpdateShapeType(val: ShapeType) {
  params.value.shapeType = val;
}

function handleUpdateShapeParam(key: string, val: any) {
  params.value[key] = val;
}

function handleUpdateShapeConfig(patch: Record<string, any>) {
  params.value.shapeConfig = { ...(params.value.shapeConfig || {}), ...patch };
}

function handleUpdateHudControl(key: string, value: any) {
  const keys = key.split('.');
  const layer = keys[0] as 'background' | 'content' | 'frame';
  if (!params.value[layer]) params.value[layer] = {};

  let target = params.value[layer];
  for (let i = 1; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === undefined) continue;
    if (!target[k]) target[k] = {};
    target = target[k];
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey !== undefined) {
    target[lastKey] = value;
  }
}

function handleSavePreset() {
  if (!newPresetName.value.trim()) return;

  const baseType = isCustom.value 
    ? presetsStore.customPresets.find(p => p.id === props.itemId)?.baseType || props.itemId
    : props.itemId;

  presetsStore.saveAsPreset(props.itemKind, baseType, newPresetName.value.trim(), params.value);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}

function handleUpdatePreset() {
  if (!isCustom.value) return;
  presetsStore.updatePreset(props.itemId, params.value);
}

const actions = computed(() => {
  const list: any[] = [];
  if (isCustom.value) {
    list.push({
      id: 'update-preset',
      label: t('common.save', 'Save'),
      icon: 'i-heroicons-check',
      onClick: handleUpdatePreset,
    });
  }
  list.push({
    id: 'save-as-preset',
    label: isCustom.value
      ? t('fastcat.effects.saveAsNew', 'Save as new')
      : t('fastcat.effects.saveAsPreset', 'Save as preset'),
    icon: 'i-heroicons-bookmark',
    onClick: () => (isSaveModalOpen.value = true),
  });
  return list;
});
</script>

<template>
  <div class="w-full flex flex-col gap-4 text-ui-text text-sm">
    <div class="flex items-center gap-2 px-1">
      <UIcon 
        :name="itemKind === 'text' ? 'i-heroicons-document-text' : itemKind === 'shape' ? 'i-heroicons-stop' : 'i-heroicons-photo'" 
        class="w-6 h-6 text-primary" 
      />
      <span class="font-medium text-base uppercase tracking-tight">
        {{ isCustom ? presetsStore.customPresets.find(p => p.id === props.itemId)?.name : itemId }}
      </span>
    </div>

    <div class="flex flex-col gap-2">
      <ClipTextProperties
        v-if="itemKind === 'text'"
        :clip="mockClip as any"
        :presets="[]"
        :hide-presets="true"
        @update-text="handleUpdateText"
        @update-text-style="handleUpdateTextStyle"
      />

      <ClipShapeProperties
        v-else-if="itemKind === 'shape'"
        :clip="mockClip as any"
        :presets="[]"
        :hide-presets="true"
        @update-shape-type="handleUpdateShapeType"
        @update-fill-color="val => handleUpdateShapeParam('fillColor', val)"
        @update-stroke-color="val => handleUpdateShapeParam('strokeColor', val)"
        @update-stroke-width="val => handleUpdateShapeParam('strokeWidth', val)"
        @update-shape-config="handleUpdateShapeConfig"
      />

      <ClipHudProperties
        v-else-if="itemKind === 'hud'"
        :clip="mockClip as any"
        :hud-manifest="hudManifest"
        :hud-control-values="hudControlValues"
        :presets="[]"
        :hide-presets="true"
        @update-hud-control="handleUpdateHudControl"
      />
    </div>

    <div class="pt-2 border-t border-ui-border">
      <PropertyActionList :actions="actions" :vertical="false" size="sm" />
    </div>

    <UiModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
    >
      <div class="flex flex-col gap-4">
        <UiFormField :label="t('common.name', 'Name')">
          <UiTextInput
            v-model="newPresetName"
            :placeholder="t('fastcat.effects.presetNamePlaceholder', 'My Custom Preset')"
            autofocus
            @keyup.enter="handleSavePreset"
          />
        </UiFormField>
      </div>
      <template #footer>
        <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" :disabled="!newPresetName.trim()" @click="handleSavePreset">
          {{ t('common.save', 'Save') }}
        </UButton>
      </template>
    </UiModal>
  </div>
</template>
