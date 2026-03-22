<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import PropertySection from '~/components/properties/PropertySection.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import UiSelect from '~/components/ui/UiSelect.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
  presets: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<{
  (e: 'updateHudControl', key: string, value: unknown): void;
  (e: 'openSavePresetModal'): void;
  (e: 'loadPreset', val: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.hudClip.hud', 'HUD')">
    <div class="flex flex-col gap-1 pb-4 border-b border-ui-border mb-4">
      <span class="text-2xs text-ui-text-muted uppercase tracking-wider font-semibold">
        {{ t('fastcat.effects.presetsTitle', 'Presets') }}
      </span>
      <div class="flex gap-2">
        <UiSelect
          v-if="props.presets.length > 0"
          :items="props.presets"
          :placeholder="t('fastcat.effects.loadPresetPlaceholder', 'Load preset...')"
          class="flex-1"
          size="xs"
          full-width
          @update:model-value="
            (v: unknown) => emit('loadPreset', (v as { value: string })?.value ?? v)
          "
        />
        <div v-else class="flex-1 text-xs text-ui-text-muted italic flex items-center">
          {{ t('fastcat.effects.noPresets', 'No presets saved') }}
        </div>
        <UButton
          size="xs"
          variant="ghost"
          color="primary"
          icon="i-heroicons-bookmark"
          :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
          @click="emit('openSavePresetModal')"
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
