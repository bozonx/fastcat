<script setup lang="ts">
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    volume: number;
    isMuted: boolean;
    orientation?: 'horizontal' | 'vertical';
    max?: number;
  }>(),
  {
    compact: false,
    orientation: 'vertical',
    max: 1,
  },
);

const emit = defineEmits<{
  (e: 'update:volume', value: number): void;
  (e: 'update:isMuted', value: boolean): void;
}>();

const { t } = useI18n();

const volumePercent = computed(() => Math.round((props.isMuted ? 0 : props.volume) * 100));

function toggleMute() {
  emit('update:isMuted', !props.isMuted);
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function onVolumeUpdate(v: number | string | undefined | null) {
  emit('update:volume', Number(v ?? 1));
}

// Popup logic for compact mode
interface PopupPosition {
  top: number;
  left: number;
}

interface ElementLike {
  $el?: Element | null;
}

const isHovered = ref(false);
const triggerEl = ref<HTMLElement | ElementLike | null>(null);
const iconAnchorEl = ref<HTMLElement | ElementLike | null>(null);
const closeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const popupPosition = ref<PopupPosition>({ top: 0, left: 0 });

function clearCloseTimer() {
  if (!closeTimer.value) return;
  clearTimeout(closeTimer.value);
  closeTimer.value = null;
}

function resolveElement(target: HTMLElement | ElementLike | null): HTMLElement | null {
  if (!target) return null;
  if (target instanceof HTMLElement) return target;
  if (target.$el instanceof HTMLElement) return target.$el;
  return null;
}

function updatePopupPosition() {
  if (!props.compact) return;
  const anchorEl = resolveElement(iconAnchorEl.value) ?? resolveElement(triggerEl.value);
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  if (props.orientation === 'horizontal') {
    popupPosition.value = {
      top: rect.top + rect.height / 2,
      left: rect.left + rect.width / 2,
    };
  } else {
    popupPosition.value = {
      top: rect.top,
      left: rect.left + rect.width / 2,
    };
  }
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
      :icon="
        isMuted || volume === 0
          ? 'i-heroicons-speaker-x-mark'
          : volume < 0.5
            ? 'i-heroicons-speaker-wave'
            : 'i-heroicons-speaker-wave'
      "
      :aria-label="
        isMuted
          ? t('fastcat.monitor.audioUnmute', 'Unmute')
          : t('fastcat.monitor.audioMute', 'Mute')
      "
      @click="toggleMute"
    />

    <UiWheelSlider
      :min="0"
      :max="max"
      :step="0.05"
      :wheel-step-multiplier="1"
      :default-value="1"
      :model-value="isMuted ? 0 : volume"
      slider-class="w-20"
      :aria-label="t('fastcat.monitor.audioVolume', 'Audio volume')"
      @update:model-value="onVolumeUpdate"
    />

    <span class="text-sm text-ui-text-muted tabular-nums min-w-12"> {{ volumePercent }}% </span>
  </div>

  <div
    v-else
    ref="triggerEl"
    class="relative flex items-center cursor-pointer transition-colors rounded p-1"
    :class="orientation === 'vertical' ? 'flex-col gap-1' : 'flex-row gap-2'"
    @mouseenter="openPopup"
    @mouseleave="scheduleClosePopup"
  >
    <UButton
      ref="iconAnchorEl"
      size="sm"
      variant="ghost"
      color="neutral"
      :icon="
        isMuted || volume === 0
          ? 'i-heroicons-speaker-x-mark'
          : volume < 0.5
            ? 'i-heroicons-speaker-wave'
            : 'i-heroicons-speaker-wave'
      "
      :aria-label="
        isMuted
          ? t('fastcat.monitor.audioUnmute', 'Unmute')
          : t('fastcat.monitor.audioMute', 'Mute')
      "
      class="pointer-events-none"
    />
    <span
      class="leading-none text-ui-text-muted tabular-nums select-none"
      :class="orientation === 'vertical' ? 'text-[10px] text-center' : 'text-sm min-w-[3ch]'"
      @click.stop="toggleMute"
    >
      {{ volumePercent }}%
    </span>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
      >
        <div
          v-if="isHovered"
          class="fixed z-[var(--z-max)] pointer-events-auto"
          :class="
            orientation === 'vertical'
              ? 'origin-bottom -translate-x-1/2 -translate-y-full'
              : '-translate-x-1/2 -translate-y-1/2'
          "
          :style="{ top: `${popupPosition.top}px`, left: `${popupPosition.left}px` }"
          @mouseenter="onPopupMouseEnter"
          @mouseleave="onPopupMouseLeave"
        >
          <div class="relative">
            <!-- Value badge -->
            <div
              class="absolute select-none whitespace-nowrap bg-neutral-800 dark:bg-neutral-900 text-white border border-neutral-700/50 text-xs font-mono px-2.5 py-1 rounded-md shadow-lg"
              :class="
                orientation === 'vertical'
                  ? 'bottom-full left-1/2 -translate-x-1/2 mb-1'
                  : 'top-1/2 right-full -translate-y-1/2 mr-2'
              "
            >
              {{ volumePercent }}%
            </div>

            <!-- Main panel with slider -->
            <div
              class="bg-ui-bg-elevated border border-ui-border rounded-lg shadow-xl px-3 py-2 flex items-center gap-2"
              :class="orientation === 'vertical' ? 'w-48 flex-row' : 'h-48 flex-col pb-4'"
            >
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :icon="
                  isMuted || volume === 0
                    ? 'i-heroicons-speaker-x-mark'
                    : volume < 0.5
                      ? 'i-heroicons-speaker-wave'
                      : 'i-heroicons-speaker-wave'
                "
                :aria-label="
                  isMuted
                    ? t('fastcat.monitor.audioUnmute', 'Unmute')
                    : t('fastcat.monitor.audioMute', 'Mute')
                "
                @click="toggleMute"
              />
              <div
                class="flex-1"
                :class="orientation === 'vertical' ? 'min-w-20' : 'min-h-20 flex justify-center'"
              >
                <UiWheelSlider
                  :min="0"
                  :max="max"
                  :step="0.05"
                  :wheel-step-multiplier="1"
                  :default-value="1"
                  :model-value="isMuted ? 0 : volume"
                  :orientation="orientation === 'vertical' ? 'horizontal' : 'vertical'"
                  :slider-class="orientation === 'vertical' ? 'w-full' : 'h-full'"
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
