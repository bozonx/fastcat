<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import type { TimelineTrack } from '~/timeline/types';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import AppModal from '~/components/ui/AppModal.vue';

const props = defineProps<{
  tracks: TimelineTrack[];
}>();

const timelineStore = useTimelineStore();
const { t } = useI18n();

const isConfirmDeleteOpen = ref(false);
const isRenameOpen = ref(false);
const renameValue = ref('');
const contextTrackId = ref<string | null>(null);

const selectedTrackId = computed(() => timelineStore.selectedTrackId);

function onSelectTrack(trackId: string) {
  timelineStore.selectTrack(trackId);
}

const selectedTrack = computed(() => {
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  const id = contextTrackId.value ?? timelineStore.selectedTrackId;
  return docTracks.find((tr) => tr.id === id) ?? null;
});

const canDeleteSelectedTrackWithoutConfirm = computed(() =>
  Boolean(selectedTrack.value && selectedTrack.value.items.length === 0),
);

function openRename(track: TimelineTrack) {
  contextTrackId.value = track.id;
  onSelectTrack(track.id);
  renameValue.value = track.name;
  isRenameOpen.value = true;
}

function confirmRename() {
  if (!selectedTrack.value) return;
  const next = renameValue.value.trim();
  if (!next) return;
  timelineStore.renameTrack(selectedTrack.value.id, next);
  isRenameOpen.value = false;
  contextTrackId.value = null;
}

function requestDelete(track: TimelineTrack) {
  contextTrackId.value = track.id;
  onSelectTrack(track.id);
  if (canDeleteSelectedTrackWithoutConfirm.value) {
    timelineStore.deleteTrack(track.id);
    contextTrackId.value = null;
    return;
  }
  isConfirmDeleteOpen.value = true;
}

function confirmDelete() {
  if (!selectedTrack.value) return;
  timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
  isConfirmDeleteOpen.value = false;
  contextTrackId.value = null;
}

function getTrackContextMenuItems(track: TimelineTrack) {
  return [
    [
      {
        label: t('granVideoEditor.timeline.renameTrack', 'Rename track'),
        icon: 'i-heroicons-pencil',
        onSelect: () => openRename(track),
      },
      {
        label: t('granVideoEditor.timeline.deleteTrack', 'Delete track'),
        icon: 'i-heroicons-trash',
        onSelect: () => requestDelete(track),
      },
    ],
  ];
}

function onDragStart(e: DragEvent, track: TimelineTrack) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(
    'application/json',
    JSON.stringify({ kind: 'timeline-track', trackId: track.id }),
  );
  e.dataTransfer.effectAllowed = 'move';
}

function onDrop(e: DragEvent, targetTrack: TimelineTrack) {
  const raw = e.dataTransfer?.getData('application/json');
  if (!raw) return;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (parsed?.kind !== 'timeline-track') return;
  const sourceId = String(parsed?.trackId ?? '');
  if (!sourceId) return;
  if (sourceId === targetTrack.id) return;

  const sourceTrack = props.tracks.find((t) => t.id === sourceId);
  if (!sourceTrack) return;
  if (sourceTrack.kind !== targetTrack.kind) return;

  const sameKindTracks = props.tracks.filter((t) => t.kind === targetTrack.kind);
  const sourceIdx = sameKindTracks.findIndex((t) => t.id === sourceTrack.id);
  const targetIdx = sameKindTracks.findIndex((t) => t.id === targetTrack.id);
  if (sourceIdx === -1 || targetIdx === -1) return;

  const nextSameKind = [...sameKindTracks];
  nextSameKind.splice(sourceIdx, 1);
  nextSameKind.splice(targetIdx, 0, sourceTrack);

  const otherKind = props.tracks.filter((t) => t.kind !== targetTrack.kind);
  const nextTracks =
    targetTrack.kind === 'video'
      ? [...nextSameKind, ...otherKind]
      : [...otherKind, ...nextSameKind];

  timelineStore.reorderTracks(nextTracks.map((t) => t.id));
}
</script>

<template>
  <div class="w-28 shrink-0 border-r border-gray-700 flex flex-col">
    <div class="h-6 border-b border-gray-700 bg-gray-850" />
    <div class="flex flex-col divide-y divide-gray-700 flex-1">
      <UContextMenu
        v-for="track in tracks"
        :key="track.id"
        :items="getTrackContextMenuItems(track)"
      >
        <div
          class="flex items-center px-2 h-10 text-xs font-medium cursor-pointer select-none"
          :class="
            selectedTrackId === track.id
              ? 'text-white bg-gray-800'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-850'
          "
          draggable="true"
          @dragstart="onDragStart($event, track)"
          @dragover.prevent
          @drop.prevent="onDrop($event, track)"
          @click="onSelectTrack(track.id)"
          @contextmenu="onSelectTrack(track.id)"
        >
          {{ track.name }}
        </div>
      </UContextMenu>
    </div>
  </div>

  <UiConfirmModal
    v-if="selectedTrack"
    v-model:open="isConfirmDeleteOpen"
    :title="t('granVideoEditor.timeline.deleteTrackTitle', 'Delete track?')"
    :description="
      t(
        'granVideoEditor.timeline.deleteTrackDescription',
        'Track is not empty. This action cannot be undone.',
      )
    "
    color="error"
    icon="i-heroicons-exclamation-triangle"
    :confirm-text="t('common.delete', 'Delete')"
    @confirm="confirmDelete"
  />

  <AppModal
    v-if="selectedTrack"
    v-model:open="isRenameOpen"
    :title="t('granVideoEditor.timeline.renameTrackTitle', 'Rename track')"
  >
    <div class="flex flex-col gap-3">
      <UInput
        v-model="renameValue"
        size="sm"
        :placeholder="t('granVideoEditor.timeline.trackName', 'Track name')"
        @keydown.enter.prevent="confirmRename"
      />
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="isRenameOpen = false">
        {{ t('common.cancel', 'Cancel') }}
      </UButton>
      <UButton color="primary" @click="confirmRename">
        {{ t('common.save', 'Save') }}
      </UButton>
    </template>
  </AppModal>
</template>
