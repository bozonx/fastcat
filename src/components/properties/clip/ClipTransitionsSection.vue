<script setup lang="ts">
import DurationSliderInput from '~/components/ui/DurationSliderInput.vue';

const props = defineProps<{
  isVideoTrack: boolean;
  transitionIn: { type: string; durationUs: number } | null;
  transitionOut: { type: string; durationUs: number } | null;
  clipDurationUs: number;
}>();

const emit = defineEmits<{
  selectEdge: [edge: 'in' | 'out'];
  toggle: [edge: 'in' | 'out'];
  updateDuration: [payload: { edge: 'in' | 'out'; durationSec: number }];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    v-if="props.isVideoTrack"
    class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
  >
    <div class="text-xs font-semibold text-ui-text uppercase tracking-wide border-b border-ui-border pb-1">
      {{ t('granVideoEditor.timeline.transitions', 'Transitions') }}
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <UButton
            v-if="props.transitionIn"
            variant="link"
            color="primary"
            size="xs"
            class="p-0 h-auto font-mono text-[11px] font-medium uppercase"
            @click="emit('selectEdge', 'in')"
          >
            IN {{ props.transitionIn.type }}
          </UButton>
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
          <DurationSliderInput
            :model-value="props.transitionIn.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (props.clipDurationUs - (props.transitionOut?.durationUs ?? 0)) / 1_000_000,
              )
            "
            :step="0.01"
            unit="s"
            :decimals="2"
            @update:model-value="(v: number) => emit('updateDuration', { edge: 'in', durationSec: v })"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <UButton
            v-if="props.transitionOut"
            variant="link"
            color="primary"
            size="xs"
            class="p-0 h-auto font-mono text-[11px] font-medium uppercase"
            @click="emit('selectEdge', 'out')"
          >
            OUT {{ props.transitionOut.type }}
          </UButton>
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
          <DurationSliderInput
            :model-value="props.transitionOut.durationUs / 1_000_000"
            :min="0.1"
            :max="
              Math.max(
                0.1,
                (props.clipDurationUs - (props.transitionIn?.durationUs ?? 0)) / 1_000_000,
              )
            "
            :step="0.01"
            unit="s"
            :decimals="2"
            @update:model-value="(v: number) => emit('updateDuration', { edge: 'out', durationSec: v })"
          />
        </div>
      </div>
    </div>
  </div>
</template>
