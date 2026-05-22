<script setup lang="ts">
import { computed } from 'vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';

interface ActionItem {
  id: string;
  label?: string;
  title?: string;
  icon: string;
  onClick: () => void;
  color?: 'neutral' | 'error' | 'success' | 'warning' | 'info' | 'primary' | 'secondary' | 'danger';
  variant?: 'solid' | 'outline' | 'soft' | 'ghost' | 'subtle' | 'link';
}

const props = defineProps<{
  commonActions: ActionItem[];
  otherActions: ActionItem[];
}>();

const emit = defineEmits<{
  rename: [];
  copy: [];
  cut: [];
  copyParameters: [];
  pasteParameters: [];
}>();

const { t } = useI18n();

const augmentedCommonActions = computed(() => {
  return props.commonActions.map((action) => {
    const baseAction = {
      ...action,
      label: undefined,
      title: action.title || action.label,
    };

    if (action.id === 'rename') {
      return { ...baseAction, onClick: () => emit('rename') };
    }
    if (action.id === 'copy') {
      return { ...baseAction, onClick: () => emit('copy') };
    }
    if (action.id === 'cut') {
      return { ...baseAction, onClick: () => emit('cut') };
    }
    if (action.id === 'copy-parameters') {
      return { ...baseAction, onClick: () => emit('copyParameters') };
    }
    if (action.id === 'paste-parameters') {
      return { ...baseAction, onClick: () => emit('pasteParameters') };
    }
    return baseAction;
  });
});

const augmentedOtherActions = computed(() => {
  return props.otherActions.map((action) => {
    if (action.id === 'copy-parameters') {
      return { ...action, onClick: () => emit('copyParameters') };
    }
    if (action.id === 'paste-parameters') {
      return { ...action, onClick: () => emit('pasteParameters') };
    }
    return action;
  });
});
</script>

<template>
  <PropertySection :title="t('fastcat.clip.actions')">
    <PropertyActionsBlock
      :quick-actions="augmentedCommonActions"
      :additional-actions="augmentedOtherActions"
    />
  </PropertySection>
</template>
