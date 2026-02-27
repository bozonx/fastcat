<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import { ref, computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

// Project settings form data
const projectName = ref(projectStore.currentProjectName || '');
const timelineName = ref(projectStore.currentFileName || '');
const frameRate = ref(30);
const resolutionWidth = ref(1920);
const resolutionHeight = ref(1080);

const availableFrameRates = [24, 25, 30, 48, 50, 60];
const commonResolutions = [
  { width: 1920, height: 1080, label: '1080p (1920×1080)' },
  { width: 1280, height: 720, label: '720p (1280×720)' },
  { width: 3840, height: 2160, label: '4K (3840×2160)' },
  { width: 2560, height: 1440, label: '2K (2560×1440)' },
];

function applySettings() {
  // Update project settings
  if (projectStore.projectSettings) {
    projectStore.projectSettings.export.fps = frameRate.value;
    projectStore.projectSettings.export.width = resolutionWidth.value;
    projectStore.projectSettings.export.height = resolutionHeight.value;
  }
  
  // Close modal
  isOpen.value = false;
  
  // Show success message
  const toast = useToast();
  toast.add({
    title: t('videoEditor.projectSettings.applied', 'Project settings applied'),
    color: 'success'
  });
}

function resetToDefaults() {
  frameRate.value = 30;
  resolutionWidth.value = 1920;
  resolutionHeight.value = 1080;
}

function onResolutionChange(resolution: { width: number; height: number; label: string }) {
  if (resolution) {
    resolutionWidth.value = resolution.width;
    resolutionHeight.value = resolution.height;
  }
}

function formatDuration(durationUs: number): string {
  const seconds = Math.floor(durationUs / 1_000_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getAllClipsCount(): number {
  if (!timelineStore.timelineDoc?.tracks) return 0;
  return timelineStore.timelineDoc.tracks.reduce((count, track) => {
    return count + (track.items?.length || 0);
  }, 0);
}
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.projectSettings.title', 'Project Settings')"
    :ui="{ content: 'max-w-3xl' }"
  >
    <div class="space-y-6">
      <!-- Project Info -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.projectInfo', 'Project Information') }}</h3>
        
        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="t('videoEditor.projectSettings.projectName', 'Project Name')">
            <UInput v-model="projectName" disabled class="bg-ui-bg-muted" />
          </UFormField>
          
          <UFormField :label="t('videoEditor.projectSettings.timelineName', 'Timeline Name')">
            <UInput v-model="timelineName" disabled class="bg-ui-bg-muted" />
          </UFormField>
        </div>
      </div>

      <!-- Timeline Settings -->
      <div class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.timelineSettings', 'Timeline Settings') }}</h3>
        
        <UFormField :label="t('videoEditor.projectSettings.frameRate', 'Frame Rate')">
          <USelectMenu
            v-model="frameRate"
            :items="availableFrameRates.map(rate => ({ value: rate, label: `${rate} fps` }))"
            value-key="value"
            label-key="label"
            placeholder="Select frame rate"
          />
        </UFormField>

        <UFormField :label="t('videoEditor.projectSettings.resolution', 'Resolution')">
          <USelectMenu
            :model-value="commonResolutions.find(res => res.width === resolutionWidth && res.height === resolutionHeight)?.label"
            :items="commonResolutions.map(res => res.label)"
            placeholder="Select resolution"
            @update:model-value="(value) => {
              const res = commonResolutions.find(r => r.label === value);
              if (res) onResolutionChange(res);
            }"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField :label="t('videoEditor.projectSettings.width', 'Width (pixels)')">
            <UInput v-model.number="resolutionWidth" type="number" min="1" />
          </UFormField>
          
          <UFormField :label="t('videoEditor.projectSettings.height', 'Height (pixels)')">
            <UInput v-model.number="resolutionHeight" type="number" min="1" />
          </UFormField>
        </div>
      </div>

      <!-- Current Timeline Info -->
      <div v-if="timelineStore.timelineDoc" class="space-y-4">
        <h3 class="text-lg font-semibold text-ui-text">{{ t('videoEditor.projectSettings.currentTimeline', 'Current Timeline') }}</h3>
        
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.duration', 'Duration') }}:</span>
              <span class="text-ui-text font-mono">{{ formatDuration(timelineStore.duration) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.tracks', 'Tracks') }}:</span>
              <span class="text-ui-text">{{ timelineStore.timelineDoc?.tracks?.length || 0 }}</span>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.clips', 'Clips') }}:</span>
              <span class="text-ui-text">{{ getAllClipsCount() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ui-text-muted">{{ t('videoEditor.projectSettings.markers', 'Markers') }}:</span>
              <span class="text-ui-text">{{ timelineStore.getMarkers().length }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('videoEditor.projectSettings.reset', 'Reset to Defaults')"
          @click="resetToDefaults"
        />
        <div class="flex items-center gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            :label="t('common.cancel', 'Cancel')"
            @click="isOpen = false"
          />
          <UButton
            variant="solid"
            color="primary"
            :label="t('videoEditor.projectSettings.apply', 'Apply Settings')"
            @click="applySettings"
          />
        </div>
      </div>
    </template>
  </AppModal>
</template>
