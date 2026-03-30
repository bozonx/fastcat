<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const clipboardStore = useAppClipboard();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const currentClipAndTrack = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks?.find(
    (tr) => tr.id === entity.trackId,
  ) as TimelineTrack | undefined;
  if (!track) return null;
  const item = track.items.find((i) => i.id === entity.itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;
  return { track, item };
});

const clip = computed(() => currentClipAndTrack.value?.item ?? null);
const clipTrack = computed(() => currentClipAndTrack.value?.track ?? null);
const isLocked = computed(() => Boolean(clip.value?.locked || clipTrack.value?.locked));

const isDeleteConfirmOpen = ref(false);

function handleCopy() {
  if (!clip.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
}

function handleCut() {
  if (!clip.value || isLocked.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
  emit('close');
}

function requestDelete() {
  if (!clip.value || isLocked.value) return;
  if (workspaceStore.userSettings.deleteWithoutConfirmation) {
    timelineStore.deleteFirstSelectedItem();
    emit('close');
  } else {
    isDeleteConfirmOpen.value = true;
  }
}

function confirmDelete() {
  timelineStore.deleteFirstSelectedItem();
  isDeleteConfirmOpen.value = false;
  emit('close');
}

function toggleDisabled() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    disabled: !clip.value.disabled,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleLocked() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    locked: !clip.value.locked,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :snap-points="['164px', 0.88]"
    direction="bottom"
    :modal="false"
    :overlay="false"
    :dismissible="false"
    :with-handle="false"
    :ui="{
      container: 'border-t border-slate-800/80 bg-slate-900/90 backdrop-blur-2xl ring-1 ring-white/5',
      header: 'p-0 px-4 pt-2 pb-1'
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-4 py-1.5 px-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-6 h-6 rounded bg-slate-800 flex items-center justify-center shrink-0">
            <UIcon name="i-heroicons-film" class="w-3.5 h-3.5 text-slate-400" />
          </div>
          <span class="text-xs font-bold text-slate-200 truncate leading-none">
            {{ clip?.name || $t('fastcat.timeline.clipActions', 'Clip') }}
          </span>
        </div>

        <!-- Toolbar controls -->
        <div class="flex items-center gap-1 shrink-0">
          <!-- Small indicator or button to show it can be expanded -->
          <div class="w-8 h-1 rounded-full bg-slate-800/80 mx-1" />
          
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            icon="lucide:maximize-2"
            class="text-slate-400"
            :ui="{ icon: 'w-4 h-4' }"
          />
        </div>
      </div>
    </template>

    <!-- Quick action buttons grid: now more compact -->
    <div v-if="clip" class="px-4 pb-4">
      <div class="grid grid-cols-5 gap-1.5">
        <!-- Copy -->
        <button
          class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none active:scale-95 bg-slate-800/40 border border-slate-700/50 text-slate-200 min-h-[58px]"
          @click="handleCopy"
        >
          <UIcon name="i-heroicons-document-duplicate" class="w-4 h-4 shrink-0" />
          <span class="text-[9px] font-medium leading-tight">{{ $t('common.copy', 'Copy') }}</span>
        </button>

        <!-- Cut -->
        <button
          class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none min-h-[58px]"
          :class="isLocked
            ? 'opacity-40 pointer-events-none bg-slate-800/40 border border-slate-700/50 text-slate-200'
            : 'active:scale-95 bg-slate-800/40 border border-slate-700/50 text-slate-200'"
          @click="handleCut"
        >
          <UIcon name="i-heroicons-scissors" class="w-4 h-4 shrink-0" />
          <span class="text-[9px] font-medium leading-tight">{{ $t('common.cut', 'Cut') }}</span>
        </button>

        <!-- Delete -->
        <button
          class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none min-h-[58px]"
          :class="isLocked
            ? 'opacity-40 pointer-events-none text-red-400 bg-red-400/10 border border-red-400/20'
            : 'active:scale-95 text-red-500/80 bg-red-400/10 border border-red-400/20'"
          @click="requestDelete"
        >
          <UIcon name="i-heroicons-trash" class="w-4 h-4 shrink-0" />
          <span class="text-[9px] font-medium leading-tight text-red-400 opacity-90">{{ $t('common.delete', 'Delete') }}</span>
        </button>

        <!-- Disable / Enable -->
        <button
          class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none active:scale-95 min-h-[58px]"
          :class="clip.disabled
            ? 'text-amber-400 bg-amber-400/10 border border-amber-400/30'
            : 'text-slate-200 bg-slate-800/40 border border-slate-700/50'"
          @click="toggleDisabled"
        >
          <UIcon :name="clip.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'" class="w-4 h-4 shrink-0" />
          <span class="text-[9px] font-medium leading-tight">
            {{ clip.disabled ? $t('fastcat.timeline.enableClip', 'Enable') : $t('fastcat.timeline.disableClip', 'Disable') }}
          </span>
        </button>

        <!-- Lock / Unlock -->
        <button
          class="flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-center transition-all outline-none active:scale-95 min-h-[58px]"
          :class="clip.locked
            ? 'text-primary-400 bg-primary-400/10 border border-primary-400/30'
            : 'text-slate-200 bg-slate-800/40 border border-slate-700/50'"
          @click="toggleLocked"
        >
          <UIcon :name="clip.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'" class="w-4 h-4 shrink-0" />
          <span class="text-[9px] font-medium leading-tight">
            {{ clip.locked ? $t('fastcat.timeline.unlockClip', 'Unlock') : $t('fastcat.timeline.lockClip', 'Lock') }}
          </span>
        </button>
      </div>
    </div>

    <!-- Separator before full properties -->
    <div class="mx-4 border-t border-slate-800/60" />

    <!-- Full clip properties (accessible when expanded) -->
    <div v-if="clip" class="px-4 pt-4 pb-8">
      <ClipProperties :clip="clip" />
    </div>

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteClipTitle', 'Delete clip?')"
      :description="t('fastcat.timeline.deleteClipDescription', 'This action cannot be undone.')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />
  </UiMobileDrawer>
</template>
