<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useUiStore } from '~/stores/ui.store';
import { storeToRefs } from 'pinia';

const uiStore = useUiStore();
const { monitorVolume, monitorMuted } = storeToRefs(uiStore);
const { t } = useI18n();

const isPopupOpen = ref(false);

function togglePopup() {
  if (isPopupOpen.value) {
    isPopupOpen.value = false;
  } else {
    isPopupOpen.value = true;
  }
}


function resetVolume() {
  monitorVolume.value = 1;
  monitorMuted.value = false;
}

const volumePercent = computed(() => {
  if (monitorMuted.value) return 0;
  return Math.round(monitorVolume.value * 100);
});

const volumeIcon = computed(() => {
  if (monitorMuted.value || monitorVolume.value === 0) return 'i-heroicons-speaker-x-mark';
  if (monitorVolume.value < 0.5) return 'i-heroicons-speaker-wave';
  return 'i-heroicons-speaker-wave';
});

function onVolumeUpdate(v: number | undefined) {
  const val = Number(v ?? 1);
  monitorVolume.value = val;
  if (monitorMuted.value && val > 0) {
    monitorMuted.value = false;
  }
}

const containerRef = ref<HTMLElement | null>(null);
onClickOutside(containerRef, onClickOutsideHandler);

function onClickOutsideHandler() {
  isPopupOpen.value = false;
}

// Ensure the popup scales for mobile appropriately
</script>

<template>
  <div ref="containerRef" class="relative flex items-center shrink-0">
    <UButton
      size="md"
      variant="ghost"
      color="neutral"
      :icon="volumeIcon"
      class="p-1 h-full aspect-square rounded-full shadow-md m-0 flex items-center justify-center bg-ui-bg-elevated/50"
      :aria-label="
        monitorMuted
          ? t('fastcat.monitor.audioUnmute', 'Unmute')
          : t('fastcat.monitor.audioMute', 'Mute')
      "
      @click="togglePopup"
    />

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 translate-y-4"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-4"
      >
        <div
          v-if="isPopupOpen"
          class="fixed bottom-[80px] left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
        >
          <div
            class="bg-ui-bg-elevated/95 backdrop-blur-md border border-ui-border rounded-xl shadow-2xl px-5 py-4 flex items-center gap-4 w-[85vw] max-w-[340px]"
          >
            <div class="flex-1 w-full flex items-center justify-center">
              <USlider
                :min="0"
                :max="2"
                :step="0.05"
                :model-value="monitorMuted ? 0 : monitorVolume"
                orientation="horizontal"
                class="w-full"
                @update:model-value="onVolumeUpdate"
              />
            </div>
            <UButton
              size="sm"
              variant="soft"
              color="neutral"
              class="font-mono tabular-nums min-w-[56px] justify-center ml-1 border border-ui-border shrink-0"
              :label="volumePercent + '%'"
              title="Reset volume to 100%"
              @click.stop="resetVolume"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
