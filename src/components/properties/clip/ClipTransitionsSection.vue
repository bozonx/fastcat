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

const isEnabled = defineModel<boolean>('enabled', { default: true });

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
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.timeline.transitions')"
    has-toggle
  >
    <div class="grid grid-cols-2 gap-2" :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <div
        class="flex flex-col gap-1"
        :class="{ 'justify-center': !props.transitionIn && props.transitionOut }"
      >
        <div class="flex items-center justify-between">
          <button
            v-if="props.transitionIn"
            class="p-0 h-auto font-mono text-2xs font-medium uppercase text-blue-500 hover:text-blue-400"
            :disabled="!isEnabled"
            @click="emit('selectEdge', 'in')"
          >
            IN {{ props.transitionIn.type }}
          </button>
          <button
            v-else
            type="button"
            class="text-2xs font-medium text-ui-text-muted w-full text-center"
            :disabled="!isEnabled"
            @click="emit('toggle', 'in')"
          >
            {{ t('fastcat.timeline.transition.addInLabel') }}
          </button>
          <UButton
            v-if="props.transitionIn"
            size="xs"
            color="red"
            variant="ghost"
            icon="i-heroicons-trash"
            :disabled="!isEnabled"
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
            full-width
            class="mb-2"
            :disabled="!isEnabled"
            @update:model-value="
              (value: unknown) =>
                value &&
                emit('updateType', {
                  edge: 'in',
                  type: (value as { value: string })?.value ?? (value as string),
                })
            "
          />
          <label class="text-2xs font-medium text-ui-text-muted mb-1 block">
            {{ t('fastcat.timeline.transition.durationSec') }}
          </label>
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
            full-width
            :disabled="!isEnabled"
            @update:model-value="
              (v: any) => emit('updateDuration', { edge: 'in', durationSec: Number(v) })
            "
          />
        </div>
      </div>

      <div
        class="flex flex-col gap-1"
        :class="{ 'justify-center': props.transitionIn && !props.transitionOut }"
      >
        <div class="flex items-center justify-between">
          <button
            v-if="props.transitionOut"
            class="p-0 h-auto font-mono text-2xs font-medium uppercase text-blue-500 hover:text-blue-400"
            :disabled="!isEnabled"
            @click="emit('selectEdge', 'out')"
          >
            OUT {{ props.transitionOut.type }}
          </button>
          <button
            v-else
            type="button"
            class="text-2xs font-medium text-ui-text-muted w-full text-center"
            :disabled="!isEnabled"
            @click="emit('toggle', 'out')"
          >
            {{ t('fastcat.timeline.transition.addOutLabel') }}
          </button>
          <UButton
            v-if="props.transitionOut"
            size="xs"
            color="red"
            variant="ghost"
            icon="i-heroicons-trash"
            :disabled="!isEnabled"
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
            full-width
            class="mb-2"
            :disabled="!isEnabled"
            @update:model-value="
              (value: unknown) =>
                value &&
                emit('updateType', {
                  edge: 'out',
                  type: (value as { value: string })?.value ?? (value as string),
                })
            "
          />
          <label class="text-2xs font-medium text-ui-text-muted mb-1 block">
            {{ t('fastcat.timeline.transition.durationSec') }}
          </label>
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
            full-width
            :disabled="!isEnabled"
            @update:model-value="
              (v: any) => emit('updateDuration', { edge: 'out', durationSec: Number(v) })
            "
          />
        </div>
      </div>
    </div>
  </PropertySection>
</template>
