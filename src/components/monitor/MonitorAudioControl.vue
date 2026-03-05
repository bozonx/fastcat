<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';
import WheelSlider from '~/components/ui/WheelSlider.vue';

const props = defineProps<{
  compact?: boolean;
}>();

const { t } = useI18n();
const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);

const volumePercent = computed(() => Math.round((monitorMuted.value ? 0 : monitorVolume.value) * 100));

function toggleMute() {
  monitorMuted.value = !monitorMuted.value;
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function onVolumeUpdate(v: number | string | undefined | null) {
  monitorVolume.value = Number(v ?? 1);
}

// Popup logic for compact mode
interface PopupPosition {
  top: number;
  left: number;
}

const isHovered = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const popupPosition = ref<PopupPosition>({ top: 0, left: 0 });

function clearCloseTimer() {
  if (!closeTimer.value) return;
  clearTimeout(closeTimer.value);
  closeTimer.value = null;
}

function updatePopupPosition() {
  if (!triggerEl.value || !props.compact) return;
  const rect = triggerEl.value.getBoundingClientRect();
  popupPosition.value = {
    top: rect.top + rect.height / 2,
    left: rect.left + rect.width / 2,
  };
}

function openPopup() {
  if (!props.compact) return;
  clearCloseTimer();
  isHovered.value = true;
  nextTick(updatePopupPosition);
}

function scheduleClosePopup() {
  if (!props.compact) return;
  clearCloseTimer();
  closeTimer.value = setTimeout(() => {
    isHovered.value = false;
  }, 90);
}

function onPopupMouseEnter() {
  clearCloseTimer();
}

function onPopupMouseLeave() {
  scheduleClosePopup();
}

onMounted(() => {
  window.addEventListener('resize', updatePopupPosition);
  window.addEventListener('scroll', updatePopupPosition, true);
});

onBeforeUnmount(() => {
  clearCloseTimer();
  window.removeEventListener('resize', updatePopupPosition);
  window.removeEventListener('scroll', updatePopupPosition, true);
});
</script>

<template>
  <div v-if="!compact" class="flex items-center gap-2.5">
    <UButton
      size="sm"
      variant="ghost"
      color="neutral"
      :icon="monitorMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
      :aria-label="
        monitorMuted
          ? t('granVideoEditor.monitor.audioUnmute', 'Unmute')
          : t('granVideoEditor.monitor.audioMute', 'Mute')
      "
      @click="toggleMute"
    />

    <WheelSlider
      :min="0"
      :max="2"
      :step="0.05"
      :wheel-step-multiplier="1"
      :default-value="1"
      :model-value="monitorMuted ? 0 : monitorVolume"
      slider-class="w-20"
      :aria-label="t('granVideoEditor.monitor.audioVolume', 'Audio volume')"
      @update:model-value="onVolumeUpdate"
    />

    <span class="text-sm text-ui-text-muted tabular-nums min-w-12"> {{ volumePercent }}% </span>
  </div>

  <div
    v-else
    ref="triggerEl"
    class="relative flex flex-col items-center gap-1 cursor-pointer transition-colors rounded p-1"
    @mouseenter="openPopup"
    @mouseleave="scheduleClosePopup"
  >
    <UButton
      size="sm"
      variant="ghost"
      color="neutral"
      :icon="monitorMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
      :aria-label="
        monitorMuted
          ? t('granVideoEditor.monitor.audioUnmute', 'Unmute')
          : t('granVideoEditor.monitor.audioMute', 'Mute')
      "
      class="pointer-events-none"
    />
    <span
      class="text-[10px] leading-none text-ui-text-muted tabular-nums text-center select-none"
      @click.stop="toggleMute"
    >
      {{ volumePercent }}%
    </span>

    <Teleport to="body">
      <Transition name="volume-panel">
        <div
          v-if="isHovered"
          class="fixed z-99999 pointer-events-auto origin-top -translate-x-1/2 -translate-y-1/2"
          :style="{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }"
          @mouseenter="onPopupMouseEnter"
          @mouseleave="onPopupMouseLeave"
        >
          <div class="relative">
            <!-- Value badge -->
            <div
              class="absolute bottom-full left-1/2 -translate-x-1/2 -mb-2 bg-neutral-800 dark:bg-neutral-900 text-white border border-neutral-700/50 text-xs font-mono px-2.5 py-1 rounded-md shadow-lg select-none whitespace-nowrap"
            >
              {{ volumePercent }}%
            </div>

            <!-- Main panel with slider -->
            <div
              class="bg-ui-bg-elevated border border-ui-border rounded-lg shadow-xl px-3 py-2 flex items-center gap-2 w-48"
            >
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="monitorMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
                :aria-label="
                  monitorMuted
                    ? t('granVideoEditor.monitor.audioUnmute', 'Unmute')
                    : t('granVideoEditor.monitor.audioMute', 'Mute')
                "
                @click="toggleMute"
              />
              <div class="flex-1 min-w-20">
                <WheelSlider
                  :min="0"
                  :max="2"
                  :step="0.05"
                  :wheel-step-multiplier="1"
                  :default-value="1"
                  :model-value="monitorMuted ? 0 : monitorVolume"
                  slider-class="w-full"
                  @update:model-value="onVolumeUpdate"
                />
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.volume-panel-enter-active,
.volume-panel-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.volume-panel-enter-from,
.volume-panel-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.95);
}
</style>
