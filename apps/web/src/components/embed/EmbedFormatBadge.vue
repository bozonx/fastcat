<script setup lang="ts">
import { computed } from 'vue';
import { formatFps } from '~/utils/format';
import type { EmbedFormatSource, EmbedFormatSummary } from '~/utils/embed/format-summary';

/**
 * The video format the session will render, and where it came from. Hosts
 * rarely say, so without this the user learns the resolution only from the
 * finished file.
 */
const props = defineProps<{
  summary: EmbedFormatSummary;
  /** Narrow toolbars keep the icon and drop the text. */
  compact?: boolean;
}>();

const emit = defineEmits<{ open: [] }>();

const { t } = useI18n();

const SOURCE_KEYS: Record<EmbedFormatSource, string> = {
  unresolved: 'fastcat.embed.format.sourceUnresolved',
  firstClip: 'fastcat.embed.format.sourceFirstClip',
  projectDefaults: 'fastcat.embed.format.sourceProjectDefaults',
  manual: 'fastcat.embed.format.sourceManual',
};

const isUnresolved = computed(() => props.summary.source === 'unresolved');

const label = computed(() =>
  isUnresolved.value
    ? t('fastcat.embed.format.unresolved')
    : `${props.summary.width}×${props.summary.height} · ${formatFps(props.summary.fps)} fps`,
);

const title = computed(() =>
  t('fastcat.embed.format.badgeTitle', { source: t(SOURCE_KEYS[props.summary.source]) }),
);
</script>

<template>
  <UButton
    size="sm"
    :color="isUnresolved ? 'warning' : 'neutral'"
    :variant="isUnresolved ? 'soft' : 'ghost'"
    :icon="isUnresolved ? 'lucide:triangle-alert' : 'lucide:ratio'"
    :label="props.compact ? undefined : label"
    :title="`${label}. ${title}`"
    :aria-label="`${label}. ${title}`"
    :data-source="props.summary.source"
    data-testid="embed-format"
    class="font-mono"
    @click="emit('open')"
  />
</template>
