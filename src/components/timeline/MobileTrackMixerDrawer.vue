<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { AudioClipEffect, TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import { linearToDb, dbToLinear, trackHasAudio } from '~/utils/audio';
import DbSlider from '~/components/audio/DbSlider.vue';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import TrackAudioEffectsModal from '~/components/audio/TrackAudioEffectsModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import { useAudioEffectCreation } from '~/composables/timeline/useAudioEffectCreation';
import { useMobileDrawerOpen } from '~/composables/ui/useMobileDrawerOpen';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const workspaceStore = useWorkspaceStore();

const isAudioEffectsEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

const isOpenLocal = useMobileDrawerOpen(props, emit);

const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

const filteredTracks = computed(() => {
  return tracks.value.filter((track) => {
    if (track.kind === 'audio') {
      return track.items.length > 0;
    }
    if (track.kind === 'video') {
      return track.items.length > 0 && trackHasAudio(track, mediaStore.mediaMetadata);
    }
    return false;
  });
});

const selectedTrackForPropertiesId = ref<string | null>(null);
const selectedTrackForProperties = computed(() =>
  tracks.value.find((t) => t.id === selectedTrackForPropertiesId.value),
);

const selectedTrackForEffects = computed(() =>
  tracks.value.find((t) => t.id === selectedTrackIdForEffects.value),
);

watch(isOpenLocal, (val) => {
  if (!val) {
    setTimeout(() => {
      selectedTrackForPropertiesId.value = null;
    }, 300);
  }
});

function toggleMute(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.toggleTrackAudioMuted(trackId);
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleSolo(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.toggleTrackAudioSolo(trackId);
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function handleTrackGainDbInput(trackId: string, dbVal: number) {
  timelineStore.updateTrackProperties(trackId, {
    audioGain: dbToLinear(dbVal),
  });
}

function getTrackGain(track: TimelineTrack) {
  return typeof track.audioGain === 'number' ? track.audioGain : 1;
}

const selectedTrackIdForEffects = ref<string | null>(null);

const audioEffectsForSelected = computed(() => {
  const track = selectedTrackForEffects.value;
  if (!track) return [];
  return (track.effects ?? []).filter((e): e is AudioClipEffect => e?.target === 'audio');
});

const {
  isSelectEffectModalOpen,
  isEffectsModalOpen,
  openSelectEffect,
  openEffectsEditor,
  handleSelectEffect,
} = useAudioEffectCreation({
  effectIdPrefix: 'audio_effect',
  getEffects: () => audioEffectsForSelected.value,
  applyEffects: (effects) => {
    const track = selectedTrackForEffects.value;
    if (!track) return;
    const videoEffects = (track.effects ?? []).filter((e) => e?.target !== 'audio');
    timelineStore.updateTrackProperties(track.id, {
      effects: [...videoEffects, ...effects],
    });
  },
});

function openSelectEffectForTrack(trackId: string) {
  selectedTrackIdForEffects.value = trackId;
  openSelectEffect();
}

function openEffectsEditorForTrack(trackId: string) {
  selectedTrackIdForEffects.value = trackId;
  openEffectsEditor();
}

function getAudioEffectsCount(track: TimelineTrack) {
  return (track.effects ?? []).filter((e) => e?.target === 'audio').length;
}

const masterVolumeDb = computed({
  get: () => linearToDb(timelineStore.masterGain ?? 1),
  set: (value: number) => {
    timelineStore.setAudioVolume(dbToLinear(value));
  },
});

function onMasterVolumeDragEnd() {
  timelineStore.applyTimeline({
    type: 'update_master_gain',
    gain: dbToLinear(masterVolumeDb.value),
  });
}

const isMasterMuted = computed(() => timelineStore.audioMuted);

function toggleMasterMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}

function formatDb(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dB`;
}

function addAudioTrack() {
  const audioCount = tracks.value.filter((t) => t.kind === 'audio').length;
  timelineStore.addTrack('audio', `Audio ${audioCount + 1}`);
}

const isRenameModalOpen = ref(false);
const trackToRename = ref<TimelineTrack | null>(null);

function handleRenameTrack(name: string) {
  if (trackToRename.value) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== trackToRename.value.name) {
      timelineStore.renameTrack(trackToRename.value.id, trimmed);
    }
  }
  isRenameModalOpen.value = false;
  trackToRename.value = null;
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :ui="{ body: 'no-scrollbar' }">
    <div
      v-if="selectedTrackForProperties"
      class="flex flex-col animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div
        class="sticky top-0 z-20 bg-ui-bg-elevated/95 backdrop-blur border-b border-ui-border p-2 flex items-center gap-2 mb-2"
      >
        <UButton
          icon="i-heroicons-chevron-left"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="void (selectedTrackForPropertiesId = null)"
        />
        <span class="font-medium text-sm text-ui-text line-clamp-1">{{
          selectedTrackForProperties.name || selectedTrackForProperties.id
        }}</span>
      </div>
      <div class="px-4 pb-4">
        <TrackProperties :track="selectedTrackForProperties" />
      </div>
    </div>

    <div
      v-else
      class="px-4 py-4 animate-in fade-in slide-in-from-left-4 duration-200 flex flex-col h-full overflow-hidden"
    >
      <!-- Tracks Container with Horizontal Scroll -->
      <div
        class="flex gap-4 overflow-x-auto pb-4 no-scrollbar items-stretch flex-1 hide-scrollbar snap-x snap-mandatory"
      >
        <!-- Master Volume (First item) -->
        <div
          class="shrink-0 w-32 rounded-xl border border-ui-border bg-ui-bg-elevated/60 p-3 shadow-sm relative overflow-hidden flex flex-col snap-start"
        >
          <div
            class="absolute inset-0 bg-linear-to-br from-primary-500/5 to-transparent pointer-events-none"
          ></div>

          <div class="flex flex-col items-center mb-3 relative z-10">
            <span
              class="text-xs font-bold text-ui-text uppercase tracking-widest mb-1 text-center w-full truncate"
            >
              {{ $t('fastcat.audioMixer.master') }}
            </span>
            <span class="text-[10px] text-ui-text-muted font-mono">{{
              formatDb(timelineStore.audioLevels?.master?.peakDb)
            }}</span>
          </div>

          <div class="flex-1 w-full min-h-[200px] flex justify-center py-2 relative z-10">
            <DbSlider
              v-model="masterVolumeDb"
              :level-db="timelineStore.audioLevels?.master?.peakDb"
              @drag-end="onMasterVolumeDragEnd"
            />
          </div>

          <div
            class="flex justify-center gap-2 mt-3 pt-3 border-t border-ui-border/50 relative z-10"
          >
            <UiToggleButton
              :model-value="isMasterMuted"
              size="xs"
              label="M"
              active-color="error"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              :title="t('fastcat.audioMixer.muteMaster')"
              class="w-8 h-8"
              @click="toggleMasterMute"
            />
          </div>
        </div>

        <!-- Individual Tracks -->
        <div
          v-for="track in filteredTracks"
          :key="track.id"
          class="shrink-0 w-32 rounded-xl border border-ui-border/80 bg-ui-bg-elevated/40 p-3 flex flex-col transition-colors group snap-start relative"
        >
          <!-- Top: Info & Display row -->
          <div class="flex flex-col items-center mb-3 gap-2">
            <div
              class="w-8 h-8 rounded shrink-0 flex items-center justify-center font-black text-xs"
              :style="{
                backgroundColor:
                  track.color && track.color !== '#2a2a2a' ? `${track.color}33` : '#1e293b',
                color: track.color && track.color !== '#2a2a2a' ? track.color : '#94a3b8',
              }"
            >
              {{ track.kind === 'video' ? 'V' : 'A'
              }}{{
                track.kind === 'video'
                  ? tracks.filter((t) => t.kind === 'video').indexOf(track) + 1
                  : tracks.filter((t) => t.kind === 'audio').indexOf(track) + 1
              }}
            </div>

            <span
              class="text-xs font-medium text-ui-text truncate w-full text-center px-1 cursor-text"
              @dblclick="
                trackToRename = track;
                isRenameModalOpen = true;
              "
            >
              {{ track.name || track.id }}
            </span>

            <template v-if="isAudioEffectsEnabled">
              <div class="w-full px-1.5 mb-1.5 shrink-0">
                <div v-if="getAudioEffectsCount(track) === 0" class="flex justify-center">
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    icon="i-heroicons-plus-circle"
                    class="w-full h-6 text-3xs px-1 py-0 justify-center whitespace-nowrap overflow-hidden hover:bg-primary-500/10 hover:text-primary-400 border border-transparent hover:border-primary-500/30"
                    @click="openSelectEffectForTrack(track.id)"
                  >
                    {{ $t('fastcat.effects.addEffect') }}
                  </UButton>
                </div>
                <div
                  v-else
                  class="w-full h-6 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 border border-primary-500/30 rounded flex items-center justify-center cursor-pointer transition-colors"
                  @click="openEffectsEditorForTrack(track.id)"
                >
                  <span class="text-3xs font-bold uppercase truncate px-1">
                    {{ $t('fastcat.effects.effectsCount', { count: getAudioEffectsCount(track) }) }}
                  </span>
                </div>
              </div>
            </template>
          </div>

          <!-- Middle: Vertical Volume Slider -->
          <div
            class="flex-1 w-full min-h-[200px] flex justify-center py-2 relative"
            :class="{ 'opacity-50 grayscale pointer-events-none': track.audioMuted }"
          >
            <DbSlider
              :model-value="linearToDb(getTrackGain(track))"
              :level-db="timelineStore.audioLevels?.[track.id]?.peakDb"
              @update:model-value="handleTrackGainDbInput(track.id, $event)"
            />
          </div>

          <!-- Bottom: Solo & Mute -->
          <div class="flex justify-center gap-2 mt-3 pt-3 border-t border-ui-border/50">
            <UiToggleButton
              :model-value="Boolean(track.audioSolo)"
              size="xs"
              icon="i-heroicons-musical-note"
              active-color="primary"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              class="w-8 h-8"
              @click="toggleSolo(track.id)"
            />
            <UiToggleButton
              :model-value="Boolean(track.audioMuted)"
              size="xs"
              label="M"
              active-color="error"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              class="w-8 h-8"
              @click="toggleMute(track.id)"
            />
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 pt-4 mt-1 border-t border-ui-border/50 shrink-0">
        <UButton
          icon="i-heroicons-musical-note"
          :label="$t('fastcat.timeline.addAudioTrack')"
          variant="soft"
          color="neutral"
          size="sm"
          class="flex-1 justify-center whitespace-normal h-auto py-2"
          @click="addAudioTrack"
        />
      </div>
    </div>

    <template v-if="isAudioEffectsEnabled">
      <SelectEffectModal
        v-model:open="isSelectEffectModalOpen"
        target="audio"
        @select="handleSelectEffect"
      />

      <TrackAudioEffectsModal
        v-if="selectedTrackForEffects"
        v-model:open="isEffectsModalOpen"
        :track-id="selectedTrackForEffects.id"
      />
    </template>

    <UiRenameModal
      :open="isRenameModalOpen"
      :initial-name="trackToRename?.name || ''"
      :title="t('fastcat.timeline.renameTrack')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRenameTrack"
    />
  </UiMobileDrawer>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
