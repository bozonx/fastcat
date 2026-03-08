<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import PropertySection from '~/components/properties/PropertySection.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import type { ClipEffect } from '~/timeline/types';
import {
  DEFAULT_TIMELINE_ZOOM_POSITION,
  formatZoomMultiplier,
  MAX_TIMELINE_ZOOM_POSITION,
  MIN_TIMELINE_ZOOM_POSITION,
  TIMELINE_ZOOM_POSITIONS,
  timelineZoomPositionToScale,
} from '~/utils/zoom';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const settingsStore = useTimelineSettingsStore();

const snapThresholdPx = computed({
  get: () => settingsStore.snapThresholdPx,
  set: (val: number) => {
    settingsStore.setSnapThresholdPx(val);
  },
});

const masterGain = computed({
  get: () => timelineStore.timelineDoc?.metadata?.gran?.masterGain ?? 1,
  set: (val: number) => {
    timelineStore.applyTimeline({
      type: 'update_master_gain',
      gain: val,
    });
  },
});

const masterEffects = computed(
  () => timelineStore.timelineDoc?.metadata?.gran?.masterEffects ?? [],
);

const masterMuted = computed({
  get: () => Boolean(timelineStore.timelineDoc?.metadata?.gran?.masterMuted),
  set: (muted: boolean) => {
    timelineStore.setMasterMuted(muted);
  },
});

const timelineZoom = computed({
  get: () => timelineStore.timelineZoom,
  set: (value: number) => {
    timelineStore.setTimelineZoom(value);
  },
});

const timelineZoomScale = computed(() => timelineZoomPositionToScale(timelineZoom.value));

const timelineZoomMultiplierInput = computed({
  get: () => formatZoomMultiplier(timelineZoomScale.value),
  set: (value: string | number) => {
    const normalized = String(value).trim().toLowerCase().replace(',', '.').replace(/^x/, '');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    timelineStore.setTimelineZoomExact(DEFAULT_TIMELINE_ZOOM_POSITION + 7 * Math.log2(parsed));
  },
});

function handleUpdateMasterEffects(effects: ClipEffect[]) {
  timelineStore.applyTimeline({
    type: 'update_master_effects',
    effects: [...effects],
  });
}

function handleAddVideoTrack() {
  const idx =
    (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'video').length ?? 0) + 1;
  timelineStore.addTrack('video', `Video ${idx}`);
}

function handleAddAudioTrack() {
  const idx =
    (timelineStore.timelineDoc?.tracks.filter((tr) => tr.kind === 'audio').length ?? 0) + 1;
  timelineStore.addTrack('audio', `Audio ${idx}`);
}
</script>

<template>
  <div class="w-full flex flex-col gap-3">
    <!-- Actions -->
    <PropertySection :title="t('granVideoEditor.timeline.properties.actions', 'Actions')">
      <div class="grid grid-cols-2 gap-2 w-full mt-1">
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-video-camera"
          class="justify-start"
          @click="handleAddVideoTrack"
        >
          {{ t('granVideoEditor.timeline.addVideoTrack', 'Add video track') }}
        </UButton>
        <UButton
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-musical-note"
          class="justify-start"
          @click="handleAddAudioTrack"
        >
          {{ t('granVideoEditor.timeline.addAudioTrack', 'Add audio track') }}
        </UButton>
      </div>

      <div class="flex flex-col gap-2 mt-3 p-2 bg-ui-bg rounded border border-ui-border">
        <div class="border-b border-ui-border pb-2 mb-1">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-xs text-ui-text-muted">{{
              t('granVideoEditor.timeline.properties.zoom', 'Zoom')
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <WheelSlider
                v-model="timelineZoom"
                :min="MIN_TIMELINE_ZOOM_POSITION"
                :max="MAX_TIMELINE_ZOOM_POSITION"
                :step="0.01"
                :steps="TIMELINE_ZOOM_POSITIONS"
                :default-value="DEFAULT_TIMELINE_ZOOM_POSITION"
              />
            </div>
            <div class="w-24 shrink-0">
              <UInput v-model="timelineZoomMultiplierInput" size="xs" class="w-full font-mono" />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.timeline.properties.snapToFrames', 'Snap to frames')
          }}</span>
          <USwitch
            size="sm"
            :model-value="settingsStore.frameSnapMode === 'frames'"
            @update:model-value="settingsStore.setFrameSnapMode($event ? 'frames' : 'free')"
          />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.timeline.properties.snapToClips', 'Snap to clips')
          }}</span>
          <USwitch
            size="sm"
            :model-value="settingsStore.clipSnapMode === 'clips'"
            @update:model-value="settingsStore.setClipSnapMode($event ? 'clips' : 'none')"
          />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{
            t('granVideoEditor.timeline.properties.overlapMode', 'Pseudo-overlap')
          }}</span>
          <USwitch
            size="sm"
            :model-value="settingsStore.overlapMode === 'pseudo'"
            @update:model-value="settingsStore.setOverlapMode($event ? 'pseudo' : 'none')"
          />
        </div>

        <div class="border-t border-ui-border pt-2 mt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-ui-text-muted">{{
              t('videoEditor.settings.snapThreshold', 'Snap threshold (px)')
            }}</span>
            <span class="text-[10px] font-mono text-ui-text-muted">{{ snapThresholdPx }}px</span>
          </div>
          <WheelSlider
            v-model="snapThresholdPx"
            :min="1"
            :max="40"
            :step="1"
            :wheel-step-multiplier="1"
          />
        </div>

        <div class="flex items-center justify-between border-t border-ui-border pt-1 mt-1">
          <span class="text-xs text-ui-text-muted">{{
            t('videoEditor.hotkeys.general.mute', 'Mute')
          }}</span>
          <USwitch
            size="sm"
            :model-value="masterMuted"
            @update:model-value="masterMuted = $event"
          />
        </div>
      </div>
    </PropertySection>

    <!-- Master Video Effects -->
    <div class="relative">
      <EffectsEditor
        :effects="masterEffects"
        :title="t('granVideoEditor.effects.masterTitle', 'Master effects')"
        @update:effects="handleUpdateMasterEffects"
      />
      <div
        v-if="masterEffects.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <div class="text-[10px] text-primary-400 font-medium uppercase tracking-wider">
          {{ t('granVideoEditor.effects.dropHint', 'Drop effect here') }}
        </div>
      </div>
    </div>

    <!-- Master Volume -->
    <PropertySection
      :title="t('granVideoEditor.timeline.properties.masterVolume', 'Master Volume')"
    >
      <div class="space-y-1.5 mt-1">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-mono text-ui-text-muted">{{ masterGain.toFixed(3) }}x</span>
        </div>
        <WheelSlider
          v-model="masterGain"
          :min="0"
          :max="2"
          :step="0.001"
          :wheel-step-multiplier="10"
          :default-value="1"
        />
      </div>
    </PropertySection>
  </div>
</template>
