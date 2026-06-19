<script setup lang="ts">
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import type { PropertyActionItem } from '~/components/properties/PropertyActionsBlock.vue';

defineProps<{
  selectedCountLabel: string;
  commonActions: PropertyActionItem[];
  otherActions: PropertyActionItem[];
  isMobile?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions')">
    <div class="flex flex-col w-full">
      <span class="text-sm text-ui-text-muted mb-2">
        {{ selectedCountLabel }}
      </span>

      <PropertyActionsBlock
        :quick-actions="isMobile ? [] : commonActions"
        :additional-actions="otherActions"
      />
    </div>
  </PropertySection>
</template>
