<script setup lang="ts">
import { computed } from 'vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { formatDurationSeconds } from '~/utils/format';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const summary = computed(() => {
  const doc = timelineStore.timelineDoc;
  if (!doc) return null;
  const videoTracks = doc.tracks.filter((tr) => tr.kind === 'video').length;
  const audioTracks = doc.tracks.filter((tr) => tr.kind === 'audio').length;
  const clips = doc.tracks.reduce(
    (acc, tr) => acc + tr.items.filter((i) => i.kind === 'clip').length,
    0,
  );
  const version = doc.metadata?.fastcat?.version ?? '-';
  const durationUs = selectTimelineDurationUs(doc);
  return {
    version,
    durationUs,
    videoTracks,
    audioTracks,
    clips,
  };
});

async function handleDuplicate() {
  await timelineStore.duplicateCurrentTimeline();
  emit('close');
}

function handleAddVideoTrack() {
  const idx = (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'video').length ?? 0) + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function handleAddAudioTrack() {
  const idx = (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'audio').length ?? 0) + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    @update:open="!$event && emit('close')"
  >
    <div class="px-4 pb-8 flex flex-col gap-6">
      <div class="flex items-center gap-2 pt-2">
        <div class="text-ui-text font-bold text-xl">{{ t('videoEditor.timeline.settings', 'Timeline settings') }}</div>
      </div>
      
      <!-- Info Section -->
      <div v-if="summary" class="flex flex-col gap-1 rounded-2xl bg-ui-bg p-4 border border-ui-border">
        <div class="text-xs font-bold text-ui-text-muted uppercase tracking-widest mb-2">
          {{ t('common.info', 'Info') }}
        </div>
        <PropertyRow
          :label="t('fastcat.timeline.version', 'Version')"
          :value="summary.version"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('common.duration', 'Duration')"
          :value="formatDurationSeconds((summary.durationUs ?? 0) / 1_000_000)"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.videoTracks', 'Video tracks')"
          :value="summary.videoTracks"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.audioTracks', 'Audio tracks')"
          :value="summary.audioTracks"
        />
        <div class="h-px bg-ui-border/50 my-1" />
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.clips', 'Clips')"
          :value="summary.clips"
        />
      </div>

      <!-- Actions Section -->
      <div class="flex flex-col gap-3">
        <div class="text-xs font-bold text-ui-text-muted uppercase tracking-widest px-1">
          {{ t('videoEditor.fileManager.actions.title', 'Actions') }}
        </div>
        
        <div class="grid grid-cols-2 gap-3">
          <UiActionButton
            icon="lucide:video"
            color="neutral"
            variant="soft"
            size="md"
            :title="t('fastcat.timeline.addVideoTrack', 'Add video track')"
            class="justify-center"
            @click="handleAddVideoTrack"
          >
            {{ t('fastcat.timeline.addVideoTrack', 'Add video') }}
          </UiActionButton>
          
          <UiActionButton
            icon="lucide:music"
            color="neutral"
            variant="soft"
            size="md"
            :title="t('fastcat.timeline.addAudioTrack', 'Add audio track')"
            class="justify-center"
            @click="handleAddAudioTrack"
          >
            {{ t('fastcat.timeline.addAudioTrack', 'Add audio') }}
          </UiActionButton>
        </div>

        <UiActionButton
          icon="lucide:copy"
          color="primary"
          variant="solid"
          size="md"
          :title="t('fastcat.timeline.createVersion', 'Create version')"
          class="w-full justify-center"
          @click="handleDuplicate"
        >
          {{ t('fastcat.timeline.createVersion', 'Create version') }}
        </UiActionButton>
      </div>
    </div>
  </UiMobileDrawer>
</template>
