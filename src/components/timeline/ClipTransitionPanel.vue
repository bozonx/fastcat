<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { getAllTransitionManifests } from '~/transitions';
import type { ClipTransition, TimelineTrack, TimelineClipItem } from '~/timeline/types';
import type {
  TransitionCurve,
  TransitionManifest,
  TransitionMode,
  TransitionParamField,
} from '~/transitions/core/registry';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import { useClipTransitionPanel } from '~/composables/timeline/useClipTransitionPanel';

import {
  getTransitionCurveSinglePath,
  getPrevClipForItem,
  getNextClipForItem,
} from '~/utils/timeline/clip';
import { usePresetsStore } from '~/stores/presets.store';
import { useSelectionStore } from '~/stores/selection.store';

interface CurveOption {
  value: TransitionCurve;
  label: string;
  curvePath: string;
  [key: string]: unknown;
}

const { t } = useI18n();

const props = defineProps<{
  edge: 'in' | 'out';
  trackId: string;
  itemId: string;
  clip?: TimelineClipItem;
  track?: TimelineTrack;
  transition: ClipTransition | undefined;
  maxDuration?: number;
  hideActions?: boolean;
}>();

const emit = defineEmits<{
  (
    e: 'update',
    payload: {
      trackId: string;
      itemId: string;
      edge: 'in' | 'out';
      transition: ClipTransition | null;
    },
  ): void;
}>();

const presetsStore = usePresetsStore();
const selectionStore = useSelectionStore();
const isSaveModalOpen = ref(false);
const newPresetName = ref('');

const manifests = computed(() => getAllTransitionManifests());

const {
  durationMax,
  durationMin,
  durationSec,
  durationStep,
  edgeIcon,
  remove,
  selectedCurve,
  selectedManifest,
  selectedMode,
  selectedParams,
  selectedType,
  updateParam,
} = useClipTransitionPanel({
  edge: toRef(props, 'edge'),
  trackId: toRef(props, 'trackId'),
  itemId: toRef(props, 'itemId'),
  transition: toRef(props, 'transition'),
  maxDuration: toRef(props, 'maxDuration'),
  onUpdate: (payload) => emit('update', payload),
});

const isAdjacentAvailable = computed(() => {
  if (!props.track || !props.clip) return true; // Default to true if missing info

  const adjacent =
    props.edge === 'in'
      ? getPrevClipForItem(props.track, props.clip)
      : getNextClipForItem(props.track, props.clip);

  if (!adjacent) return false;

  const clipEdgeUs =
    props.edge === 'in'
      ? props.clip.timelineRange.startUs
      : props.clip.timelineRange.startUs + props.clip.timelineRange.durationUs;
  const adjacentEdgeUs =
    props.edge === 'in'
      ? adjacent.timelineRange.startUs + adjacent.timelineRange.durationUs
      : adjacent.timelineRange.startUs;

  return Math.abs(clipEdgeUs - adjacentEdgeUs) <= 1_000;
});

const sourceOptions = computed(() => [
  {
    value: 'adjacent',
    label: t('fastcat.timeline.transition.sourceAdjacentShort'),
    title: t('fastcat.timeline.transition.sourceAdjacent'),
    disabled: !isTransitionModeAvailable(selectedManifest.value, 'adjacent'),
  },
  {
    value: 'background',
    label: t('fastcat.timeline.transition.sourceBackgroundShort'),
    title: t('fastcat.timeline.transition.sourceBackground'),
    disabled: !isTransitionModeAvailable(selectedManifest.value, 'background'),
  },
  {
    value: 'transparent',
    label: t('fastcat.timeline.transition.sourceTransparentShort'),
    title: t('fastcat.timeline.transition.sourceTransparent'),
    disabled: !isTransitionModeAvailable(selectedManifest.value, 'transparent'),
  },
]);

function isTransitionModeAvailable(
  manifest: TransitionManifest | undefined,
  mode: TransitionMode,
): boolean {
  if (mode === 'adjacent' && !isAdjacentAvailable.value) {
    return false;
  }

  return !manifest?.supportedModes || manifest.supportedModes.includes(mode);
}

function isManifestAvailable(manifest: TransitionManifest): boolean {
  const modes = manifest.supportedModes ?? ['adjacent', 'background', 'transparent'];
  return modes.some((mode) => isTransitionModeAvailable(manifest, mode));
}

const transitionOptions = computed(() =>
  manifests.value.map((manifest) => ({
    value: manifest.type,
    label: manifest.name,
    icon: manifest.icon,
    disabled: !isManifestAvailable(manifest),
  })),
);

function selectValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'value' in value) {
    const nested = (value as Record<string, unknown>).value;
    return typeof nested === 'string' ? nested : undefined;
  }
  return undefined;
}

function updateTypeFromSelect(value: unknown) {
  const selected = selectValue(value);
  if (selected) selectedType.value = selected;
}

watch(
  [manifests, selectedManifest, sourceOptions],
  () => {
    if (selectedManifest.value && !isManifestAvailable(selectedManifest.value)) {
      const fallbackManifest = manifests.value.find((manifest) => isManifestAvailable(manifest));
      if (fallbackManifest && fallbackManifest.type !== selectedType.value) {
        selectedType.value = fallbackManifest.type;
        return;
      }
    }

    const supportedModes = selectedManifest.value?.supportedModes;
    if (!supportedModes || supportedModes.includes(selectedMode.value)) {
      return;
    }

    const fallbackMode = supportedModes[0];
    if (fallbackMode) {
      selectedMode.value = fallbackMode;
    }
  },
  { immediate: true },
);

const curveOptions = computed<CurveOption[]>(() => {
  const curves: TransitionCurve[] = ['linear', 'smooth', 'ease-in', 'ease-out'];

  return curves.map((curve) => {
    // Static parameters for preset previews
    const previewParams =
      curve === 'linear'
        ? undefined
        : {
            curveBulge: 0.8,
            curveOffset: curve === 'ease-in' ? 1.0 : curve === 'ease-out' ? 0.0 : 0.5,
          };

    return {
      value: curve,
      label: t(`fastcat.timeline.transition.curve${toCurveLabelKey(curve)}`),
      curvePath: getTransitionCurveSinglePath(100, 100, curve, previewParams),
    };
  });
});

const resultCurvePath = computed(() => {
  return getTransitionCurveSinglePath(240, 100, selectedCurve.value, selectedParams.value);
});

function toCurveOption(option: unknown): CurveOption {
  return option as CurveOption;
}

function toCurveLabelKey(curve: TransitionCurve): string {
  switch (curve) {
    case 'linear':
      return 'Linear';
    case 'smooth':
      return 'Smooth';
    case 'ease-in':
      return 'EaseIn';
    case 'ease-out':
      return 'EaseOut';
  }
}

function handleCurveChange(curve: TransitionCurve) {
  selectedCurve.value = curve;

  if (curve === 'linear') {
    // Keep as is or remove params
  } else {
    // Reset to defaults for each type
    const bulge = 0.8;
    let offset = 0.5;

    if (curve === 'ease-in') offset = 1.0;
    else if (curve === 'ease-out') offset = 0.0;

    updateParam('curveBulge', bulge);
    updateParam('curveOffset', offset);
  }
}

const visibleParamFields = computed<TransitionParamField[]>(() => {
  const fields = selectedManifest.value?.paramFields ?? [];

  const filtered = fields.filter((field) => {
    if (field.showIf && !field.showIf(selectedParams.value)) {
      return false;
    }
    return true;
  });

  if (selectedType.value !== 'wipe' && selectedType.value !== 'barn-door') {
    return filtered;
  }

  const edgeMode = selectedParams.value.edgeMode === 'blur' ? 'blur' : 'gap';

  return filtered.filter((field) => {
    if (field.key === 'gap' || field.key === 'gapColor') {
      return edgeMode === 'gap';
    }

    if (field.key === 'blur' || field.key === 'blurMode') {
      return edgeMode === 'blur';
    }

    return true;
  });
});

function handleGoToClip() {
  selectionStore.selectTimelineItem(props.trackId, props.itemId, 'clip');
}

function handleSavePreset() {
  if (!selectedManifest.value || !newPresetName.value.trim() || !props.transition) return;

  const baseType = selectedManifest.value.baseType || selectedManifest.value.type;
  const paramsToSave = { ...selectedParams.value };

  presetsStore.saveAsPreset('transition', baseType, newPresetName.value.trim(), paramsToSave);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}

defineExpose({
  openSaveModal: () => {
    isSaveModalOpen.value = true;
  },
});
</script>

<template>
  <div
    class="flex flex-col gap-3 p-3 bg-ui-bg-elevated border border-ui-border rounded-lg text-xs text-ui-text min-w-56 shadow-lg w-full"
  >
    <!-- Header with edge icon -->
    <div v-if="!hideActions" class="flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <UIcon :name="edgeIcon" class="w-4 h-4 shrink-0 text-primary-400" />
        <span>{{ edge === 'in' ? 'IN' : 'OUT' }} {{ t('fastcat.timeline.transition.title') }}</span>
      </div>
      <div class="flex items-center gap-1">
        <UiTooltip :text="t('fastcat.timeline.transition.goToClip')">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-heroicons-arrow-uturn-left"
            @click="handleGoToClip"
          />
        </UiTooltip>
        <UiTooltip :text="t('fastcat.effects.saveAsPreset')">
          <UButton
            v-if="transition"
            color="primary"
            variant="ghost"
            size="xs"
            icon="i-heroicons-bookmark"
            @click="isSaveModalOpen = true"
          />
        </UiTooltip>
        <UiTooltip
          :text="
            edge === 'in'
              ? t('fastcat.timeline.removeTransitionIn')
              : t('fastcat.timeline.removeTransitionOut')
          "
        >
          <UButton
            v-if="transition"
            color="red"
            variant="ghost"
            size="xs"
            icon="i-heroicons-trash"
            @click="remove"
          />
        </UiTooltip>
      </div>
    </div>

    <!-- Transition type picker -->
    <UiSelect
      :model-value="selectedType"
      :items="transitionOptions"
      value-key="value"
      label-key="label"
      size="xs"
      full-width
      :searchable="false"
      @update:model-value="updateTypeFromSelect"
    >
      <template #leading>
        <UIcon v-if="selectedManifest" :name="selectedManifest.icon" class="w-4 h-4 shrink-0" />
      </template>
      <template #item-leading="{ item }">
        <UIcon v-if="item.icon" :name="item.icon" class="w-4 h-4 shrink-0" />
      </template>
    </UiSelect>

    <UiFormField :label="t('fastcat.timeline.transition.duration')">
      <UiSliderInput
        v-model="durationSec"
        :min="durationMin"
        :max="durationMax"
        :step="durationStep"
        unit="s"
        :decimals="2"
      />
    </UiFormField>

    <UiFormField :label="t('fastcat.timeline.transition.source')">
      <UiButtonGroup v-model="selectedMode" :options="sourceOptions" />
    </UiFormField>

    <UiFormField :label="t('fastcat.timeline.transition.curve')">
      <UiButtonGroup
        :model-value="selectedCurve"
        :options="curveOptions"
        orientation="vertical"
        fluid
        @update:model-value="handleCurveChange as (value: unknown) => any"
      >
        <template #option="{ option }">
          <div class="flex items-center gap-2 w-full min-w-0">
            <svg
              class="w-14 h-8 shrink-0 rounded overflow-hidden"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <rect x="0" y="0" width="100" height="100" fill="rgba(255,255,255,0.04)" />
              <path
                :d="toCurveOption(option).curvePath"
                fill="none"
                stroke="currentColor"
                stroke-width="7"
                stroke-linecap="round"
              />
            </svg>
            <span class="min-w-0 text-left leading-tight whitespace-normal">{{
              toCurveOption(option).label
            }}</span>
          </div>
        </template>
      </UiButtonGroup>
    </UiFormField>

    <!-- Curve fine-tuning sliders -->
    <div
      v-if="selectedCurve !== 'linear'"
      class="flex flex-col gap-2 p-2 bg-ui-bg/30 rounded border border-ui-border/50"
    >
      <UiFormField :label="t('fastcat.timeline.transition.curveParamBulge')">
        <UiSliderInput
          :model-value="Number(selectedParams.curveBulge ?? 0.8)"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="updateParam('curveBulge', $event)"
        />
      </UiFormField>
      <UiFormField :label="t('fastcat.timeline.transition.curveParamOffset')">
        <UiSliderInput
          :model-value="Number(selectedParams.curveOffset ?? 0.5)"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="updateParam('curveOffset', $event)"
        />
      </UiFormField>

      <!-- Result Graph -->
      <div class="flex flex-col gap-1 mt-1 pt-2 border-t border-ui-border/30">
        <svg
          class="w-full h-16 rounded overflow-hidden bg-black/40 text-primary-400"
          viewBox="0 0 240 100"
          preserveAspectRatio="none"
        >
          <!-- Grid lines -->
          <line
            x1="0"
            y1="50"
            x2="240"
            y2="50"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="4"
            opacity="0.1"
          />
          <line
            x1="120"
            y1="0"
            x2="120"
            y2="100"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="4"
            opacity="0.1"
          />

          <path
            :d="resultCurvePath"
            fill="none"
            stroke="currentColor"
            stroke-width="5"
            stroke-linecap="round"
            class="drop-shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary-400)_30%,transparent)]"
          />
        </svg>
      </div>
    </div>

    <div v-if="visibleParamFields.length" class="flex flex-col gap-2">
      <UiFormField :label="t('fastcat.timeline.transition.parameters')">
        <TransitionParamFields
          :fields="visibleParamFields"
          :params="selectedParams"
          @update:param="updateParam"
        />
      </UiFormField>
    </div>

    <PresetSaveModal
      v-model:open="isSaveModalOpen"
      v-model:name="newPresetName"
      @save="handleSavePreset"
    />
  </div>
</template>
