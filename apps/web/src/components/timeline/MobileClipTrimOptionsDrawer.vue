<script setup lang="ts">
import { useSelectedTimelineClip } from '~/composables/timeline/useSelectedTimelineClip';
import { useCloseModel } from '~/composables/ui/useCloseModel';
import { useTimelineStore } from '~/stores/timeline.store';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'back' | 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isOpenLocal = useCloseModel(
  () => props.isOpen,
  () => emit('close'),
);

const { clip, isLocked } = useSelectedTimelineClip();

async function runTrim(action: () => void | Promise<void>) {
  if (!clip.value || isLocked.value) return;
  await action();
  emit('back');
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false">
    <template #header>
      <div class="flex items-center justify-between px-3 w-full">
        <UButton
          icon="i-heroicons-chevron-left"
          variant="ghost"
          color="gray"
          size="sm"
          @click="emit('back')"
        />
        <span class="text-xs font-bold text-ui-text uppercase tracking-wider">
          {{ t('fastcat.timeline.trimByPlayhead') }}
        </span>
        <UButton
          icon="i-heroicons-x-mark"
          variant="ghost"
          color="gray"
          size="sm"
          @click="emit('close')"
        />
      </div>
    </template>

    <div class="flex flex-col gap-3 px-4 pb-8 pt-3">
      <div class="bg-ui-bg rounded-xl border border-ui-border/80 overflow-hidden shadow-inner">
        <div class="grid grid-cols-2 divide-x divide-ui-border/80">
          <div class="py-2 text-center">
            <span class="text-[10px] uppercase font-black text-ui-text-muted tracking-wider">
              {{ t('fastcat.timeline.leftTail') }}
            </span>
          </div>
          <div class="py-2 text-center">
            <span class="text-[10px] uppercase font-black text-ui-text-muted tracking-wider">
              {{ t('fastcat.timeline.rightTail') }}
            </span>
          </div>
        </div>

        <div class="border-t border-ui-border/80 divide-y divide-ui-border/80">
          <div class="grid grid-cols-2 divide-x divide-ui-border/80">
            <button
              class="py-3 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.trimToPlayheadLeftNoRipple)"
            >
              {{ t('fastcat.timeline.trim') }}
            </button>
            <button
              class="py-3 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.trimToPlayheadRightNoRipple)"
            >
              {{ t('fastcat.timeline.trim') }}
            </button>
          </div>

          <div class="grid grid-cols-2 divide-x divide-ui-border/80">
            <button
              class="py-3 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.rippleTrimLeft)"
            >
              {{ t('fastcat.timeline.trimWithOffset') }}
            </button>
            <button
              class="py-3 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.rippleTrimRight)"
            >
              {{ t('fastcat.timeline.trimWithOffset') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>
