<script setup lang="ts">
import { ref } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import type { ShapeType, HudType } from '~/timeline/types';

const { t } = useI18n();
const selectionStore = useSelectionStore();

const activeTab = ref<'shapes' | 'hud'>('shapes');

const shapes = [
  { type: 'square' as ShapeType, name: 'Square', icon: 'i-heroicons-stop' },
  { type: 'circle' as ShapeType, name: 'Circle', icon: 'i-ph-circle' },
  { type: 'triangle' as ShapeType, name: 'Triangle', icon: 'i-ph-triangle' },
  { type: 'star' as ShapeType, name: 'Star', icon: 'i-heroicons-star' },
  { type: 'bang' as ShapeType, name: 'Bang', icon: 'i-heroicons-sparkles' },
  { type: 'cloud' as ShapeType, name: 'Cloud', icon: 'i-heroicons-cloud' },
  {
    type: 'speech_bubble' as ShapeType,
    name: 'Speech Bubble',
    icon: 'i-heroicons-chat-bubble-oval-left',
  },
];

const huds = [{ type: 'media_frame' as HudType, name: 'Media Frame', icon: 'i-heroicons-photo' }];

function handleDragStart(event: DragEvent, type: string, category: 'shape' | 'hud') {
  if (!event.dataTransfer) return;

  // Set JSON data for dragging directly onto timeline tracks
  event.dataTransfer.setData(
    'application/json',
    JSON.stringify({
      kind: category,
      name: type,
      path: '',
      type: type, // 'square', 'media_frame', etc
    }),
  );

  event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated text-sm relative min-h-0">
    <!-- Tabs -->
    <div
      class="flex items-center border-b border-ui-border shrink-0 px-2 pt-2 gap-1 bg-ui-bg-elevated sticky top-0 z-10"
    >
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'shapes'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'shapes'"
      >
        {{ t('fastcat.library.tabs.shapes', 'Shapes') }}
      </button>
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'hud'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'hud'"
      >
        {{ t('fastcat.library.tabs.hud', 'HUD') }}
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto bg-ui-bg p-3">
      <!-- Shapes -->
      <div v-show="activeTab === 'shapes'" class="grid grid-cols-1 gap-2 pb-4">
        <div
          v-for="shape in shapes"
          :key="shape.type"
          class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated"
          draggable="true"
          @dragstart="handleDragStart($event, shape.type, 'shape')"
        >
          <UIcon :name="shape.icon" class="w-8 h-8 text-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-ui-text">
              {{ t(`fastcat.library.shapes.${shape.type}`, shape.name) }}
            </h4>
          </div>
        </div>
      </div>

      <!-- HUDs -->
      <div v-show="activeTab === 'hud'" class="grid grid-cols-1 gap-2 pb-4">
        <div
          v-for="hud in huds"
          :key="hud.type"
          class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated"
          draggable="true"
          @dragstart="handleDragStart($event, hud.type, 'hud')"
        >
          <UIcon :name="hud.icon" class="w-8 h-8 text-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-ui-text">
              {{ t(`fastcat.library.huds.${hud.type}`, hud.name) }}
            </h4>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
