<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem } from '~/timeline/types';

interface MixerTrackModel {
  id: string;
  name: string;
  kind: 'audio' | 'video';
  gain: number;
  balance: number;
  muted: boolean;
  solo: boolean;
  peakDb?: number;
}

const { t } = useI18n();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();

function clipHasAudio(item: TimelineTrackItem, track: TimelineTrack): boolean {
  if (item.kind !== 'clip') return false;
  const clip = item as TimelineClipItem;
  if (track.kind === 'video' && clip.audioFromVideoDisabled) return false;
  if (clip.clipType !== 'media' && clip.clipType !== 'timeline') return track.kind === 'audio';
  if (!clip.source?.path) return track.kind === 'audio';
  const meta = mediaStore.mediaMetadata[clip.source.path];
  return Boolean(meta?.audio) || track.kind === 'audio';
}

function trackHasAudio(track: TimelineTrack): boolean {
  return track.items.some((item) => clipHasAudio(item, track));
}

const trackCards = computed<MixerTrackModel[]>(() => {
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];

  return docTracks.filter(trackHasAudio).map((track) => ({
    id: track.id,
    name: track.name || track.id,
    kind: track.kind,
    gain: typeof track.audioGain === 'number' ? track.audioGain : 1,
    balance: typeof track.audioBalance === 'number' ? track.audioBalance : 0,
    muted: Boolean(track.audioMuted),
    solo: Boolean(track.audioSolo),
    peakDb: timelineStore.audioLevels?.[track.id]?.peakDb,
  }));
});

const masterPeakDb = computed(() => timelineStore.audioLevels?.master?.peakDb);
const masterVolume = computed({
  get: () => Math.round(timelineStore.masterGain * 100),
  set: (value: number) => {
    timelineStore.setMasterGain(Math.max(0, Math.min(4, value / 100)));
  },
});

const isMasterMuted = computed(() => timelineStore.audioMuted);

function formatDb(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dB`;
}

function formatPan(value: number): string {
  if (Math.abs(value) < 0.01) return t('common.panCenter');
  if (value < 0) return t('common.panLeft', { value: Math.round(Math.abs(value) * 100) });
  return t('common.panRight', { value: Math.round(Math.abs(value) * 100) });
}

function updateTrackGain(trackId: string, rawValue: number | string) {
  const numeric = Number(rawValue);
  timelineStore.updateTrackProperties(trackId, {
    audioGain: Math.max(0, Math.min(4, numeric / 100)),
  });
}

function updateTrackPan(trackId: string, rawValue: number | string) {
  const numeric = Number(rawValue);
  timelineStore.updateTrackProperties(trackId, {
    audioBalance: Math.max(-1, Math.min(1, numeric / 100)),
  });
}

function toggleTrackMute(trackId: string) {
  timelineStore.toggleTrackAudioMuted(trackId);
}

function toggleTrackSolo(trackId: string) {
  timelineStore.toggleTrackAudioSolo(trackId);
}

function toggleMasterMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}

function updateMasterVolume(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  masterVolume.value = target.valueAsNumber;
}

function handleTrackGainInput(trackId: string, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  updateTrackGain(trackId, target.value);
}

function handleTrackPanInput(trackId: string, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  updateTrackPan(trackId, target.value);
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto bg-slate-950 text-slate-100">
    <div class="flex flex-col gap-4 p-4 pb-6">
      <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500">
              {{ t('fastcat.audioMixer.title', 'Mixer') }}
            </p>
            <h2 class="mt-1 text-base font-semibold text-white">
              {{ t('fastcat.audioMixer.master') }} {{ t('fastcat.audioMixer.output') }}
            </h2>
          </div>
          <UiToggleButton
            :model-value="isMasterMuted"
            size="sm"
            label="M"
            active-color="error"
            inactive-color="neutral"
            inactive-variant="soft"
            active-variant="solid"
            title="Mute master"
            @click="toggleMasterMute"
          />
        </div>

        <div class="mt-4 space-y-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>{{ $t('common.level') }}</span>
            <span class="font-medium text-slate-200">{{ masterVolume }}%</span>
          </div>
          <input
            :value="masterVolume"
            type="range"
            min="0"
            max="400"
            step="1"
            class="w-full accent-primary-500"
            @input="updateMasterVolume"
          />
          <div class="flex items-center justify-between text-2xs text-slate-500">
            <span>{{ $t('common.peak') }}</span>
            <span>{{ formatDb(masterPeakDb) }}</span>
          </div>
        </div>
      </section>

      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-white">{{ $t('common.tracks') }}</h3>
            <p class="text-xs text-slate-500">{{ t('fastcat.audioMixer.tracksHint') }}</p>
          </div>
          <div class="rounded-full border border-slate-800 px-2 py-1 text-2xs text-slate-400">
            {{ trackCards.length }}
          </div>
        </div>

        <div
          v-if="trackCards.length === 0"
          class="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-500"
        >
          {{ t('fastcat.audioMixer.noTracks') }}
        </div>

        <div v-else class="space-y-3">
          <article
            v-for="track in trackCards"
            :key="track.id"
            class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h4 class="truncate text-sm font-medium text-white">{{ track.name }}</h4>
                <p class="text-2xs text-slate-500">
                  {{
                    track.kind === 'video'
                      ? $t('fastcat.track.video.title')
                      : $t('fastcat.track.audio.title')
                  }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UiToggleButton
                  :model-value="track.muted"
                  size="xs"
                  label="M"
                  active-color="error"
                  inactive-color="neutral"
                  inactive-variant="soft"
                  active-variant="solid"
                  title="Mute track"
                  @click="toggleTrackMute(track.id)"
                />
                <UiToggleButton
                  :model-value="track.solo"
                  size="xs"
                  label="S"
                  active-color="primary"
                  inactive-color="neutral"
                  inactive-variant="soft"
                  active-variant="solid"
                  title="Solo track"
                  @click="toggleTrackSolo(track.id)"
                />
              </div>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-slate-400">
                  <span>{{ $t('fastcat.clip.audio.volume') }}</span>
                  <span class="font-medium text-slate-200"
                    >{{ Math.round(track.gain * 100) }}%</span
                  >
                </div>
                <input
                  :value="Math.round(track.gain * 100)"
                  type="range"
                  min="0"
                  max="400"
                  step="1"
                  class="w-full accent-primary-500"
                  @input="handleTrackGainInput(track.id, $event)"
                />
              </div>

              <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-slate-400">
                  <span>{{ $t('common.pan') }}</span>
                  <span class="font-medium text-slate-200">{{ formatPan(track.balance) }}</span>
                </div>
                <input
                  :value="Math.round(track.balance * 100)"
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  class="w-full accent-primary-500"
                  @input="handleTrackPanInput(track.id, $event)"
                />
              </div>
            </div>

            <div class="mt-3 flex items-center justify-between text-2xs text-slate-500">
              <span>{{ $t('common.peak') }}</span>
              <span>{{ formatDb(track.peakDb) }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
