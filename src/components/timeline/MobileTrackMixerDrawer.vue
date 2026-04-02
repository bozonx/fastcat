<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import { linearToDb, dbToLinear, trackHasAudio } from '~/utils/audio';
import DbSlider from '~/components/audio/DbSlider.vue';
import SelectEffectModal from '~/components/effects/SelectEffectModal.vue';
import TrackAudioEffectsModal from '~/components/audio/TrackAudioEffectsModal.vue';
import { getAudioEffectManifest } from '~/effects';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

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

const isSelectEffectModalOpen = ref(false);
const isEffectsModalOpen = ref(false);
const selectedTrackIdForEffects = ref<string | null>(null);

function openSelectEffect(trackId: string) {
  selectedTrackIdForEffects.value = trackId;
  isSelectEffectModalOpen.value = true;
}

function openEffectsEditor(trackId: string) {
  selectedTrackIdForEffects.value = trackId;
  isEffectsModalOpen.value = true;
}

function handleSelectEffect(type: string) {
  const trackId = selectedTrackIdForEffects.value;
  if (!trackId) return;

  const manifest = getAudioEffectManifest(type);
  if (!manifest) return;

  const track = tracks.value.find((t) => t.id === trackId);
  if (!track) return;

  const newEffect = {
    id: `audio_effect_${Date.now()}`,
    type,
    enabled: true,
    target: 'audio',
    ...(manifest.defaultValues || {}),
  };

  const currentEffects = track.effects ?? [];
  timelineStore.updateTrackProperties(trackId, {
    effects: [...currentEffects, newEffect] as any,
  });

  isSelectEffectModalOpen.value = false;
  isEffectsModalOpen.value = true;
}

function getAudioEffectsCount(track: TimelineTrack) {
  return (track.effects ?? []).filter((e) => e?.target === 'audio').length;
}

const masterVolumeDb = computed({
  get: () => linearToDb(timelineStore.masterGain ?? 1),
  set: (value: number) => {
    timelineStore.setMasterGain(dbToLinear(value));
  },
});

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

const renamingTrackId = ref<string | null>(null);
const renameValue = ref('');

function startRename(track: TimelineTrack) {
  renamingTrackId.value = track.id;
  renameValue.value = track.name || track.id;
}

function confirmRename() {
  if (renamingTrackId.value) {
    const next = renameValue.value.trim();
    const track = tracks.value.find((t) => t.id === renamingTrackId.value);
    if (track && next && next !== track.name) {
      timelineStore.renameTrack(renamingTrackId.value, next);
    }
  }
  renamingTrackId.value = null;
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :title="
      selectedTrackForProperties
        ? $t('common.properties', 'Properties')
        : $t('fastcat.audioMixer.title', 'Mixer & Tracks')
    "
    :ui="{ body: 'no-scrollbar' }"
  >
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
          @click="selectedTrackForPropertiesId = null"
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
          class="shrink-0 w-32 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 shadow-sm relative overflow-hidden flex flex-col snap-start"
        >
          <div
            class="absolute inset-0 bg-linear-to-br from-primary-500/5 to-transparent pointer-events-none"
          ></div>

          <div class="flex flex-col items-center mb-3 relative z-10">
            <span
              class="text-xs font-bold text-zinc-100 uppercase tracking-widest mb-1 text-center w-full truncate"
            >
              {{ $t('fastcat.audioMixer.master', 'Master') }}
            </span>
            <span class="text-[10px] text-zinc-500 font-mono">{{
              formatDb(timelineStore.audioLevels?.master?.peakDb)
            }}</span>
          </div>

          <div class="flex-1 w-full min-h-[200px] flex justify-center py-2 relative z-10">
            <DbSlider
              v-model="masterVolumeDb"
              :level-db="timelineStore.audioLevels?.master?.peakDb"
            />
          </div>

          <div
            class="flex justify-center gap-2 mt-3 pt-3 border-t border-zinc-800/50 relative z-10"
          >
            <UiToggleButton
              :model-value="isMasterMuted"
              size="xs"
              label="M"
              active-color="error"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              title="Mute master"
              class="w-8 h-8"
              @click="toggleMasterMute"
            />
          </div>
        </div>

        <!-- Individual Tracks -->
        <div
          v-for="track in filteredTracks"
          :key="track.id"
          class="shrink-0 w-32 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 flex flex-col transition-colors group snap-start relative"
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

            <div v-if="renamingTrackId === track.id" class="w-full">
              <input
                v-model="renameValue"
                class="w-full bg-zinc-950 border border-primary-500 text-zinc-100 rounded px-1 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary-500 text-center"
                autofocus
                @blur="confirmRename"
                @keydown.enter="confirmRename"
                @keydown.esc="renamingTrackId = null"
              />
            </div>
            <span
              v-else
              class="text-xs font-medium text-zinc-200 truncate w-full text-center px-1 cursor-text"
              @dblclick="startRename(track)"
            >
              {{ track.name || track.id }}
            </span>

            <div class="w-full px-1.5 mb-1.5 shrink-0">
              <div v-if="getAudioEffectsCount(track) === 0" class="flex justify-center">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-heroicons-plus-circle"
                  class="w-full h-6 text-3xs px-1 py-0 justify-center whitespace-nowrap overflow-hidden hover:bg-primary-500/10 hover:text-primary-400 border border-transparent hover:border-primary-500/30"
                  @click="openSelectEffect(track.id)"
                >
                  {{ $t('fastcat.effects.addEffect') }}
                </UButton>
              </div>
              <div
                v-else
                class="w-full h-6 bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 border border-primary-500/30 rounded flex items-center justify-center cursor-pointer transition-colors"
                @click="openEffectsEditor(track.id)"
              >
                <span class="text-3xs font-bold uppercase truncate px-1">
                  {{ $t('fastcat.effects.effectsCount', { count: getAudioEffectsCount(track) }) }}
                </span>
              </div>
            </div>
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
          <div class="flex justify-center gap-2 mt-3 pt-3 border-t border-zinc-800/50">
            <UiToggleButton
              :model-value="Boolean(track.audioSolo)"
              size="xs"
              label="S"
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
      <div class="flex gap-2 pt-4 mt-1 border-t border-zinc-800/50 shrink-0">
        <UButton
          icon="i-heroicons-musical-note"
          :label="$t('fastcat.timeline.addAudioTrack', 'Add Audio Track')"
          variant="soft"
          color="neutral"
          size="sm"
          class="flex-1 justify-center whitespace-normal h-auto py-2"
          @click="addAudioTrack"
        />
      </div>
    </div>

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
