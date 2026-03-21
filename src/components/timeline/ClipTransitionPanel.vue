<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { getAllTransitionManifests } from '~/transitions';
import type { ClipTransition, TimelineTrack, TimelineClipItem } from '~/timeline/types';
import type { TransitionCurve, TransitionParamField } from '~/transitions/core/registry';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';
import { useClipTransitionPanel } from '~/composables/timeline/useClipTransitionPanel';
import {
  getTransitionCurveSinglePath,
  getPrevClipForItem,
  getNextClipForItem,
} from '~/utils/timeline/clip';
import { usePresetsStore } from '~/stores/presets.store';

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
    disabled: !isAdjacentAvailable.value,
  },
  {
    value: 'background',
    label: t('fastcat.timeline.transition.sourceBackgroundShort'),
    title: t('fastcat.timeline.transition.sourceBackground'),
  },
  {
    value: 'transparent',
    label: t('fastcat.timeline.transition.sourceTransparentShort'),
    title: t('fastcat.timeline.transition.sourceTransparent'),
  },
]);

const curveOptions = computed<CurveOption[]>(() => {
  const curves: TransitionCurve[] = ['linear', 'smooth', 'ease-in', 'ease-out'];

  return curves.map((curve) => {
    return {
      value: curve,
      label: t(`fastcat.timeline.transition.curve${toCurveLabelKey(curve)}`),
      curvePath: getTransitionCurveSinglePath(100, 100, curve, selectedParams.value),
    };
  });
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
    let bulge = 0.8;
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

function handleSavePreset() {
  if (!selectedManifest.value || !newPresetName.value.trim() || !props.transition) return;

  const baseType = selectedManifest.value.baseType || selectedManifest.value.type;
  const paramsToSave = { ...selectedParams.value };

  presetsStore.saveAsPreset('transition', baseType, newPresetName.value.trim(), paramsToSave);

  isSaveModalOpen.value = false;
  newPresetName.value = '';
}
</script>

<template>
  <div
    class="flex flex-col gap-3 p-3 bg-ui-bg-elevated border border-ui-border rounded-lg text-xs text-ui-text min-w-56 shadow-lg"
  >
    <!-- Header with edge icon -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <UIcon :name="edgeIcon" class="w-4 h-4 shrink-0 text-primary-400" />
        <span>{{ edge === 'in' ? 'IN' : 'OUT' }} {{ t('fastcat.timeline.transition.title') }}</span>
      </div>
      <div class="flex items-center gap-1">
        <UButton
          v-if="transition"
          color="primary"
          variant="ghost"
          size="xs"
          icon="i-heroicons-bookmark"
          :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
          @click="isSaveModalOpen = true"
        />
        <UButton
          v-if="transition"
          color="red"
          variant="ghost"
          size="xs"
          icon="i-heroicons-trash"
          :title="
            edge === 'in'
              ? t('fastcat.timeline.removeTransitionIn')
              : t('fastcat.timeline.removeTransitionOut')
          "
          @click="remove"
        />
      </div>
    </div>

    <!-- Transition type picker -->
    <div class="flex flex-col gap-1.5">
      <button
        v-for="manifest in manifests"
        :key="manifest.type"
        type="button"
        class="flex items-center gap-2 px-2 py-1.5 rounded border transition-colors"
        :class="
          selectedType === manifest.type
            ? 'bg-primary-500/20 border-primary-500 text-primary-400'
            : 'bg-ui-bg border-ui-border hover:bg-ui-bg-hover'
        "
        @click="selectedType = manifest.type"
      >
        <UIcon :name="manifest.icon" class="w-4 h-4 shrink-0" />
        <span>{{ manifest.name }}</span>
      </button>
    </div>

    <!-- Duration slider -->
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-ui-text-muted">
        <span>{{ t('fastcat.timeline.transition.duration') }}</span>
      </div>
      <UiSliderInput
        v-model="durationSec"
        :min="durationMin"
        :max="durationMax"
        :step="durationStep"
        unit="s"
        :decimals="2"
      />
    </div>

    <!-- Mode toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-ui-text-muted">{{ t('fastcat.timeline.transition.source') }}</span>
      <UiButtonGroup v-model="selectedMode" :options="sourceOptions" />
    </div>

    <!-- Curve toggle -->
    <div class="flex flex-col gap-1">
      <span class="text-ui-text-muted">{{ t('fastcat.timeline.transition.curve') }}</span>
      <UiButtonGroup
        :model-value="selectedCurve"
        :options="curveOptions"
        orientation="vertical"
        fluid
        @update:model-value="handleCurveChange"
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
    </div>

    <!-- Curve fine-tuning sliders -->
    <div v-if="selectedCurve !== 'linear'" class="flex flex-col gap-2 p-2 bg-ui-bg/30 rounded border border-ui-border/50">
      <div class="flex flex-col gap-1">
        <span class="text-ui-text-muted text-[10px] uppercase font-bold tracking-wider">
          {{ t('fastcat.timeline.transition.curveParamBulge') }}
        </span>
        <UiSliderInput
          :model-value="Number(selectedParams.curveBulge ?? 0.8)"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="updateParam('curveBulge', $event)"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-ui-text-muted text-[10px] uppercase font-bold tracking-wider">
          {{ t('fastcat.timeline.transition.curveParamOffset') }}
        </span>
        <UiSliderInput
          :model-value="Number(selectedParams.curveOffset ?? 0.5)"
          :min="0"
          :max="1"
          :step="0.01"
          @update:model-value="updateParam('curveOffset', $event)"
        />
      </div>
    </div>

    <div v-if="visibleParamFields.length" class="flex flex-col gap-2">
      <div class="text-ui-text-muted">
        {{ t('fastcat.timeline.transition.parameters') }}
      </div>
      <TransitionParamFields
        :fields="visibleParamFields"
        :params="selectedParams"
        @update:param="updateParam"
      />
    </div>

    <UiModal
      v-model:open="isSaveModalOpen"
      :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
    >
      <div class="flex flex-col gap-4">
        <UFormField :label="t('common.name', 'Name')">
          <UiTextInput
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
    </UiModal>
  </div>
</template>
