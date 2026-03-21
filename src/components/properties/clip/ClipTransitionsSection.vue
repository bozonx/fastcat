<script setup lang="ts">
import { computed } from 'vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import { getAllTransitionManifests } from '~/transitions';

const props = defineProps<{
  isVideoTrack: boolean;
  transitionIn: import('~/timeline/types').ClipTransition | null;
  transitionOut: import('~/timeline/types').ClipTransition | null;
  clipDurationUs: number;
}>();

const emit = defineEmits<{
  selectEdge: [edge: 'in' | 'out'];
  toggle: [edge: 'in' | 'out'];
  updateDuration: [payload: { edge: 'in' | 'out'; durationSec: number }];
  updateType: [payload: { edge: 'in' | 'out'; type: string }];
}>();

const { t } = useI18n();
const transitionOptions = computed(() =>
  getAllTransitionManifests().map((manifest) => ({
    label: manifest.name,
    value: manifest.type,
    icon: manifest.icon,
  })),
);
</script>

<template>
  <PropertySection
    v-if="props.isVideoTrack"
    :title="t('fastcat.timeline.transitions', 'Transitions')"
  >
    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <button
            v-if="props.transitionIn"
            class="p-0 h-auto font-mono text-[11px] font-medium uppercase text-blue-500 hover:text-blue-400"
            @click="emit('selectEdge', 'in')"
          >
            IN {{ props.transitionIn.type }}
          </button>
          <button
            v-else
            type="button"
            class="text-[11px] font-medium text-ui-text-muted uppercase text-left"
            @click="emit('selectEdge', 'in')"
          >
            IN
          </button>
          <UButton
            size="xs"
            :color="props.transitionIn ? 'red' : 'primary'"
            variant="ghost"
            :icon="props.transitionIn ? 'i-heroicons-trash' : 'i-heroicons-plus-circle'"
            @click="emit('toggle', 'in')"
          />
        </div>

        <div v-if="props.transitionIn" class="pl-1.5 border-l-2 border-primary-500/40">
          <UiSelect
            :model-value="props.transitionIn.type"
            :items="transitionOptions"
            value-key="value"
            label-key="label"
            size="xs"
            class="mb-2"
            @update:model-value="
              (value: unknown) =>
                value &&
                emit('updateType', {
                  edge: 'in',
                  type: (value as { value: string })?.value ?? (value as string),
                })
            "
          />
          <UiWheelNumberInput
            :model-value="props.transitionIn.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (props.clipDurationUs - (props.transitionOut?.durationUs ?? 0)) / 1_000_000,
              )
            "
            :step="0.1"
            :wheel-step-multiplier="10"
            @update:model-value="
              (v: any) => emit('updateDuration', { edge: 'in', durationSec: Number(v) })
            "
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <button
            v-if="props.transitionOut"
            class="p-0 h-auto font-mono text-[11px] font-medium uppercase text-blue-500 hover:text-blue-400"
            @click="emit('selectEdge', 'out')"
          >
            OUT {{ props.transitionOut.type }}
          </button>
          <button
            v-else
            type="button"
            class="text-[11px] font-medium text-ui-text-muted uppercase text-left"
            @click="emit('selectEdge', 'out')"
          >
            OUT
          </button>
          <UButton
            size="xs"
            :color="props.transitionOut ? 'red' : 'primary'"
            variant="ghost"
            :icon="props.transitionOut ? 'i-heroicons-trash' : 'i-heroicons-plus-circle'"
            @click="emit('toggle', 'out')"
          />
        </div>

        <div v-if="props.transitionOut" class="pl-1.5 border-l-2 border-primary-500/40">
          <UiSelect
            :model-value="props.transitionOut.type"
            :items="transitionOptions"
            value-key="value"
            label-key="label"
            size="xs"
            class="mb-2"
            @update:model-value="
              (value: unknown) =>
                value &&
                emit('updateType', {
                  edge: 'out',
                  type: (value as { value: string })?.value ?? (value as string),
                })
            "
          />
          <UiWheelNumberInput
            :model-value="props.transitionOut.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (props.clipDurationUs - (props.transitionIn?.durationUs ?? 0)) / 1_000_000,
              )
            "
            :step="0.1"
            :wheel-step-multiplier="10"
            @update:model-value="
              (v: any) => emit('updateDuration', { edge: 'out', durationSec: Number(v) })
            "
          />
        </div>
      </div>
    </div>
  </PropertySection>
</template>
