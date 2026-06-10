<script setup lang="ts">
import { computed } from 'vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import TimelineProperties from '~/components/properties/TimelineProperties.vue';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const fileManager = useFileManager();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const timelineFsEntry = computed(() => {
  const currentTimelinePath = projectStore.currentTimelinePath;
  if (currentTimelinePath) {
    const entry = fileManager.findEntryByPath(currentTimelinePath);
    if (entry && entry.kind === 'file') {
      return entry;
    }
    return {
      name: currentTimelinePath.split('/').pop() || 'Timeline.otio',
      path: currentTimelinePath,
      kind: 'file' as const,
      source: 'local' as const,
    };
  }
  return null;
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    @update:open="!$event && emit('close')"
  >
    <div class="px-4 pb-8 flex flex-col gap-4 pt-2">
      <div class="flex items-center gap-2">
        <div class="text-ui-text font-bold text-xl">{{ t('videoEditor.timeline.settings') }}</div>
      </div>

      <TimelineProperties :fs-entry="timelineFsEntry" is-mobile />
    </div>
  </MobileTimelineDrawer>
</template>
