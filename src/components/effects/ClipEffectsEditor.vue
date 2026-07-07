<script setup lang="ts">
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';

import { computed, ref } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import EffectSettingsModal from '~/components/effects/EffectSettingsModal.vue';
import { getVideoEffectManifest, getAudioEffectManifest } from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import { genUuid } from '~/utils/ids';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';
import type { VideoClipEffect, AudioClipEffect } from '~/timeline/types';
import type { ParamsKeyframeHooks } from '~/components/properties/ParamsRenderer.vue';

/**
 * Keyframe hooks for animating VIDEO clip-effect params. Supplied only by the
 * per-clip properties panel; absent for audio, track and master effects (which
 * have no clip-local timeline), so those keep the plain static-edit behaviour.
 */
export interface ClipEffectKeyframeHooks {
  isAnimated: (effectId: string, key: string) => boolean;
  /** Toggle animation for a param; seeds from the effect's current value. */
  toggle: (effectId: string, key: string) => void;
  /** Record an edit as a keyframe when animated; returns true if consumed. */
  recordEdit: (effectId: string, key: string, value: unknown) => boolean;
  /** Interpolated-at-playhead overlay for an effect's animated params. */
  displayValues: (effect: Record<string, unknown>) => Record<string, unknown>;
}

/** Effect param kinds that support keyframe animation. */
const KEYFRAMABLE_KINDS = ['slider', 'knob', 'number', 'toggle', 'boolean', 'color'];

interface Props {
  effects?: Array<VideoClipEffect | AudioClipEffect>;
  title?: string;
  addLabel?: string;
  emptyLabel?: string;
  hasToggle?: boolean;
  disabled?: boolean;
  target: 'video' | 'audio';
  keyframes?: ClipEffectKeyframeHooks;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:effects': [effects: Array<VideoClipEffect | AudioClipEffect>];
}>();

const isEnabled = defineModel<boolean>('enabled');

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isEffectModalOpen = ref(false);
const isSaveModalOpen = ref(false);
const settingsEffectId = ref<string | null>(null);
const newPresetName = ref('');
const savingEffectId = ref<string | null>(null);

const isAudio = computed(() => props.target === 'audio');

const safeTitle = computed(() => {
  if (props.title) return props.title;
  return isAudio.value ? t('fastcat.effects.audioTitle') : t('fastcat.effects.title');
});
const safeAddLabel = computed(() => props.addLabel ?? t('fastcat.effects.add'));
const safeEmptyLabel = computed(() => props.emptyLabel ?? t('fastcat.effects.empty'));

const safeEffects = computed(() => props.effects ?? []);

interface EffectItem {
  effect: Record<string, unknown>;
  manifest: ReturnType<typeof getVideoEffectManifest | typeof getAudioEffectManifest>;
}

const effectsWithManifest = computed<EffectItem[]>(() =>
  safeEffects.value.map((effect) => {
    const typed = effect as Record<string, unknown>;
    const type = String(typed.type ?? '');
    return {
      effect: typed,
      manifest: isAudio.value ? getAudioEffectManifest(type) : getVideoEffectManifest(type),
    };
  }),
);

const activeSettingsEffect = computed(() => {
  if (!settingsEffectId.value) return null;
  return (
    (safeEffects.value.find((e) => (e as Record<string, unknown>).id === settingsEffectId.value) as
      | Record<string, unknown>
      | undefined) ?? null
  );
});

const activeSettingsManifest = computed(() => {
  if (!activeSettingsEffect.value) return null;
  const type = String(activeSettingsEffect.value.type ?? '');
  return isAudio.value ? getAudioEffectManifest(type) : getVideoEffectManifest(type);
});

const { zoneAttrs: dropZoneAttrs } = useDndDropZone(
  {
    canAccept: (payload: DndPayload) => props.disabled !== true && payload.source === 'effect',
    onOver: (ctx: DndDragContext) => ctx.setOperation('effect'),
    onDrop: (ctx: DndDragContext) => {
      if (props.disabled) return;
      const type = (ctx.payload.data as { type?: string })?.type;
      if (type) handleAddEffect(type);
    },
  },
  'clip-effects',
);

function setEffects(next: Array<VideoClipEffect | AudioClipEffect>) {
  emit('update:effects', next);
}

function handleAddEffect(type: string) {
  if (props.disabled) return;

  const manifest = isAudio.value ? getAudioEffectManifest(type) : getVideoEffectManifest(type);
  if (!manifest) return;

  const newEffect = {
    id: isAudio.value ? `audio_effect_${genUuid()}` : `effect_${Date.now()}`,
    type,
    enabled: true,
    target: props.target,
    ...manifest.defaultValues,
  } as VideoClipEffect | AudioClipEffect;

  setEffects([...safeEffects.value, newEffect]);
  isEffectModalOpen.value = false;
}

function handleUpdateEffect(effectId: string, updates: Record<string, unknown>) {
  const next = safeEffects.value.map((e) => {
    const item = e as Record<string, unknown>;
    return item.id === effectId
      ? ({ ...item, ...updates } as VideoClipEffect | AudioClipEffect)
      : e;
  });
  setEffects(next);
}

function handleRemoveEffect(effectId: string) {
  setEffects(safeEffects.value.filter((e) => (e as Record<string, unknown>).id !== effectId));
}

function handleSavePreset() {
  if (!savingEffectId.value || !newPresetName.value.trim()) return;

  const effect = safeEffects.value.find(
    (e) => (e as Record<string, unknown>).id === savingEffectId.value,
  ) as Record<string, unknown> | undefined;
  if (!effect) return;

  const type = String(effect.type ?? '');
  const manifest = isAudio.value ? getAudioEffectManifest(type) : getVideoEffectManifest(type);
  if (!manifest) return;

  const baseType = manifest.baseType || manifest.type;
  const paramsToSave = { ...effect };
  delete paramsToSave.id;
  delete paramsToSave.type;
  delete paramsToSave.enabled;
  if (isAudio.value) {
    delete paramsToSave.target;
  }

  presetsStore.saveAsPreset(
    'effect',
    baseType,
    newPresetName.value.trim(),
    paramsToSave,
    isAudio.value ? 'audio' : undefined,
  );

  isSaveModalOpen.value = false;
  newPresetName.value = '';
  savingEffectId.value = null;
}

function openSaveModal(effectId: string) {
  savingEffectId.value = effectId;
  isSaveModalOpen.value = true;
}

function handleUpdateEffectValue(effectId: string, key: string, value: unknown) {
  // When the param is animated, the edit becomes a keyframe at the playhead and
  // the static value is left untouched.
  if (props.keyframes?.recordEdit(effectId, key, value)) return;
  handleUpdateEffect(effectId, { [key]: value });
}

/** Per-effect adapter passed to ParamsRenderer (numeric/boolean params only). */
function paramsKeyframesFor(effectId: string): ParamsKeyframeHooks | undefined {
  const kf = props.keyframes;
  if (!kf) return undefined;
  return {
    isKeyframable: (_key: string, kind: string) => KEYFRAMABLE_KINDS.includes(kind),
    isAnimated: (key: string) => kf.isAnimated(effectId, key),
    toggle: (key: string) => kf.toggle(effectId, key),
  };
}

/** The values shown for an effect: static params with animated ones interpolated. */
function effectRenderValues(effect: Record<string, unknown>): Record<string, unknown> {
  if (!props.keyframes) return effect;
  return { ...effect, ...props.keyframes.displayValues(effect) };
}

function handleAction(effectId: string, action: string, _key: string) {
  if (action === 'open-settings') {
    settingsEffectId.value = effectId;
  }
}

function onUpdateOrder(newEffects: unknown[]) {
  setEffects(newEffects as Array<VideoClipEffect | AudioClipEffect>);
}

function resolveEffectName(manifest: EffectItem['manifest'], type: string) {
  if (!manifest) return type;
  if ('nameKey' in manifest && manifest.nameKey) {
    return t(manifest.nameKey);
  }
  return manifest.name || type;
}
</script>

<template>
  <PropertySection
    v-model:enabled="isEnabled"
    :title="safeTitle"
    class="mt-2"
    :has-toggle="props.hasToggle"
    :data-testid="`clip-effects-${props.target}`"
    v-bind="dropZoneAttrs"
  >
    <template #header-actions>
      <UButton
        size="xs"
        variant="soft"
        color="primary"
        icon="i-heroicons-plus"
        :disabled="props.disabled"
        :data-testid="`clip-effects-${props.target}-add`"
        @click="void (isEffectModalOpen = true)"
      >
        {{ safeAddLabel }}
      </UButton>
    </template>

    <div class="space-y-2 py-1">
      <UiEmptyState
        v-if="safeEffects.length === 0"
        :message="safeEmptyLabel"
        wrapper-class="py-2 not-italic"
        :class="{ 'opacity-50': props.disabled }"
      />

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
          :key="String(effect.id)"
          class="bg-ui-bg border border-ui-border rounded px-2 py-2"
          :class="{ 'opacity-50 pointer-events-none': props.disabled }"
          :data-testid="`clip-effect-${String(effect.type)}`"
        >
          <div class="flex items-center w-full gap-2 mb-1">
            <UIcon
              name="i-heroicons-bars-2"
              class="drag-handle w-4 h-4 text-ui-text-muted hover:text-ui-text cursor-grab active:cursor-grabbing shrink-0"
            />
            <USwitch
              :model-value="Boolean(effect.enabled)"
              size="sm"
              class="shrink-0"
              :disabled="props.disabled"
              @update:model-value="handleUpdateEffect(String(effect.id), { enabled: $event })"
            />
            <span class="font-medium flex-1 truncate">
              {{ resolveEffectName(manifest, String(effect.type)) }}
            </span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                size="xs"
                variant="ghost"
                color="primary"
                icon="i-heroicons-bookmark"
                :title="t('fastcat.effects.saveAsPreset')"
                :disabled="props.disabled"
                @click="openSaveModal(String(effect.id))"
              />
              <UiActionButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-trash"
                :disabled="props.disabled"
                @click="handleRemoveEffect(String(effect.id))"
              />
            </div>
          </div>

          <div class="mt-1 pl-1">
            <ParamsRenderer
              v-if="manifest?.controls"
              :controls="manifest.controls"
              :values="effectRenderValues(effect)"
              :keyframes="paramsKeyframesFor(String(effect.id))"
              :disabled="props.disabled || !effect.enabled"
              :test-id-prefix="`clip-effect-${String(effect.type)}`"
              @update:value="
                (key: string, value: unknown) =>
                  handleUpdateEffectValue(String(effect.id), key, value)
              "
              @action="
                (action: string, key: string) => handleAction(String(effect.id), action, key)
              "
            />
          </div>
        </div>
      </VueDraggable>
    </div>

    <EffectSettingsModal
      v-if="isAudio && settingsEffectId"
      :model-value="true"
      :effect="activeSettingsEffect ?? undefined"
      :manifest="activeSettingsManifest ?? undefined"
      @update:model-value="
        (val: boolean) => {
          if (!val) settingsEffectId = null;
        }
      "
      @update:effect="
        (updates: Record<string, unknown>) => handleUpdateEffect(settingsEffectId!, updates)
      "
    />

    <SelectEffectModal
      v-model:open="isEffectModalOpen"
      :target="props.target"
      @select="handleAddEffect"
    />

    <PresetSaveModal
      v-model:open="isSaveModalOpen"
      v-model:name="newPresetName"
      @save="handleSavePreset"
    />
  </PropertySection>
</template>
