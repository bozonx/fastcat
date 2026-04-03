<script setup lang="ts">
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import { useTimelineStore } from '~/stores/timeline.store';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

async function handleDuplicate() {
  await timelineStore.duplicateCurrentTimeline();
  emit('close');
}
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    @update:open="if (!$event) emit('close')"
  >
    <div class="p-4 flex flex-col gap-4">
      <div class="text-ui-text font-medium text-lg">{{ t('videoEditor.timeline.settings', 'Timeline settings') }}</div>
      
      <UiActionButton
        icon="lucide:copy"
        color="primary"
        variant="solid"
        size="md"
        :title="t('videoEditor.timeline.createVersion', 'Create version')"
        class="w-full justify-center"
        @click="handleDuplicate"
      >
        {{ t('videoEditor.timeline.createVersion', 'Create version') }}
      </UiActionButton>
    </div>
  </UiMobileDrawer>
</template>
