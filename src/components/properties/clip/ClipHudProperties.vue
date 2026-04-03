<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import PropertySection from '~/components/properties/PropertySection.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
  presets: Array<{ label: string; value: string }>;
  hidePresets?: boolean;
}>();

const emit = defineEmits<{
  (e: 'updateHudControl', key: string, value: unknown): void;
  (e: 'loadPreset', val: string): void;
  (e: 'savePreset'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.hudClip.hud')">
    <div v-if="!hidePresets" class="flex flex-col gap-1 pb-2 border-b border-ui-border mb-4">
      <div class="flex items-center justify-between">
        <div class="text-[10px] font-medium uppercase tracking-wider text-ui-text-muted opacity-70">
          {{ t('fastcat.effects.presetsTitle', 'Presets') }}
        </div>
        <UButton
          icon="i-heroicons-bookmark"
          variant="ghost"
          size="2xs"
          color="white"
          @click="emit('savePreset')"
        >
          {{ t('fastcat.presets.saveAsPreset', 'Save') }}
        </UButton>
      </div>
      <div class="flex gap-2">
        <UiSelect
          :items="props.presets"
          :placeholder="t('fastcat.effects.loadPresetPlaceholder')"
          class="flex-1"
          size="xs"
          full-width
          @update:model-value="
            (v: unknown) => emit('loadPreset', (v as { value: string })?.value ?? v)
          "
        />
      </div>
    </div>

    <ParamsRenderer
      v-if="props.hudManifest"
      :controls="props.hudManifest.controls"
      :values="props.hudControlValues"
      @update:value="(key, value) => emit('updateHudControl', key, value)"
    />
  </PropertySection>
</template>
