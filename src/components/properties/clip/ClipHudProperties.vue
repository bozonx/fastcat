<script setup lang="ts">
import type { TimelineClipItem } from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import PropertySection from '~/components/properties/PropertySection.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'updateHudControl', key: string, value: unknown): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.hudClip.hud', 'HUD')">
    <ParamsRenderer
      v-if="props.hudManifest"
      :controls="props.hudManifest.controls"
      :values="props.hudControlValues"
      @update:value="(key, value) => emit('updateHudControl', key, value)"
    />
  </PropertySection>
</template>
