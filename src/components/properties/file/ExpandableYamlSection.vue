<script setup lang="ts">
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  title: string;
  content: string;
  expanded: boolean;
  onToggle: () => void;
  onCopy: (value: string) => void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="props.title">
    <div class="flex gap-2">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :label="props.expanded ? t('common.hide', 'Hide') : t('common.show', 'Show')"
        @click="props.onToggle"
      />
      <UButton
        v-if="props.expanded"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-heroicons-clipboard-document"
        :title="t('common.copy', 'Copy')"
        @click="props.onCopy(props.content)"
      />
    </div>
    <pre
      v-if="props.expanded"
      class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded"
      >{{ props.content }}</pre
    >
  </PropertySection>
</template>
