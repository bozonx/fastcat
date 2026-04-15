<script setup lang="ts">
import { computed } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

interface ActionItem {
  id: string;
  label?: string;
  title?: string;
  icon: string;
  onClick: () => void;
  color?: 'neutral' | 'error' | 'success' | 'warning' | 'info' | 'primary' | 'secondary' | 'danger';
}

const props = defineProps<{
  commonActions: ActionItem[];
  otherActions: ActionItem[];
}>();

const emit = defineEmits<{
  rename: [];
  copy: [];
  cut: [];
}>();

const { t } = useI18n();

const augmentedCommonActions = computed(() => {
  return props.commonActions.map((action) => {
    if (action.id === 'rename') {
      return { ...action, onClick: () => emit('rename') };
    }
    if (action.id === 'copy') {
      return { ...action, onClick: () => emit('copy') };
    }
    if (action.id === 'cut') {
      return { ...action, onClick: () => emit('cut') };
    }
    return action;
  });
});
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions')">
    <div class="flex flex-col w-full">
      <PropertyActionList
        :actions="augmentedCommonActions"
        :vertical="false"
        justify="start"
        variant="ghost"
        size="sm"
        class="mb-2"
      />

      <PropertyActionList :actions="otherActions" justify="start" size="sm" />
    </div>
  </PropertySection>
</template>
