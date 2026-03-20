<script setup lang="ts">
import { ref, computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';
import type { ShapeType, HudType } from '~/timeline/types';
import CollapsibleEffectGroup from '~/components/effects/CollapsibleEffectGroup.vue';

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();

const activeTab = ref<'shapes' | 'hud'>('shapes');

const standardShapes = [
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

const standardHuds = [
  { type: 'media_frame' as HudType, name: 'Media Frame', icon: 'i-heroicons-photo' },
];

const customShapes = computed(() => {
  return presetsStore.customPresets
    .filter((p) => p.category === 'shape')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

const customHuds = computed(() => {
  return presetsStore.customPresets
    .filter((p) => p.category === 'hud')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

function handleDragStart(
  event: DragEvent,
  type: string,
  category: 'shape' | 'hud',
  presetParams?: any,
) {
  if (!event.dataTransfer) return;

  event.dataTransfer.setData(
    'application/json',
    JSON.stringify({
      kind: category,
      name: type,
      path: '',
      type: type,
      presetParams,
    }),
  );

  event.dataTransfer.effectAllowed = 'copy';
}

function updateCustomShapesOrder(newCustomShapes: any[]) {
  presetsStore.updatePresetsOrder(
    'shape',
    newCustomShapes.map((s) => s.id),
  );
}

function updateCustomHudsOrder(newCustomHuds: any[]) {
  presetsStore.updatePresetsOrder(
    'hud',
    newCustomHuds.map((h) => h.id),
  );
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
      <div v-show="activeTab === 'shapes'" class="flex flex-col gap-4 pb-4">
        <!-- Standard Shapes -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.shapesStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="shape in standardShapes"
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
            <div
              v-if="standardShapes.length === 0"
              class="text-center text-ui-text-muted py-4 italic text-xs"
            >
              {{ t('common.noData') }}
            </div>
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Shapes -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.shapesCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customShapes"
            class="flex flex-col gap-2"
            :animation="150"
            ghost-class="opacity-50"
            handle=".drag-handle"
            filter=".external-drag"
            :prevent-on-filter="false"
            @update:model-value="updateCustomShapesOrder"
          >
            <div
              v-for="shape in customShapes"
              :key="shape.id"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors group border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated"
            >
              <div class="cursor-grab hover:text-ui-text text-ui-text-muted drag-handle">
                <UIcon name="i-heroicons-bars-2" class="w-5 h-5" />
              </div>
              <div
                class="external-drag flex items-center gap-3 flex-1 min-w-0"
                draggable="true"
                @dragstart="handleDragStart($event, shape.id, 'shape', shape.params)"
              >
                <UIcon
                  :name="
                    standardShapes.find((s) => s.type === shape.baseType)?.icon ||
                    'i-heroicons-stop'
                  "
                  class="w-8 h-8 text-primary shrink-0"
                />
                <div class="flex-1 min-w-0 flex items-center justify-between">
                  <h4 class="text-sm font-medium text-ui-text truncate">{{ shape.name }}</h4>
                  <UButton
                    icon="i-heroicons-trash"
                    color="red"
                    variant="ghost"
                    size="xs"
                    class="opacity-0 group-hover:opacity-100"
                    @click.stop="presetsStore.removePreset(shape.id)"
                  />
                </div>
              </div>
            </div>
          </VueDraggable>
          <div
            v-if="customShapes.length === 0"
            class="text-center text-ui-text-muted py-4 italic text-xs"
          >
            {{ t('common.noData') }}
          </div>
        </CollapsibleEffectGroup>
      </div>

      <!-- HUDs -->
      <div v-show="activeTab === 'hud'" class="flex flex-col gap-4 pb-4">
        <!-- Standard HUDs -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.hudsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="hud in standardHuds"
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
            <div
              v-if="standardHuds.length === 0"
              class="text-center text-ui-text-muted py-4 italic text-xs"
            >
              {{ t('common.noData') }}
            </div>
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom HUDs -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.hudsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customHuds"
            class="flex flex-col gap-2"
            :animation="150"
            ghost-class="opacity-50"
            handle=".drag-handle"
            filter=".external-drag"
            :prevent-on-filter="false"
            @update:model-value="updateCustomHudsOrder"
          >
            <div
              v-for="hud in customHuds"
              :key="hud.id"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors group border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated"
            >
              <div class="cursor-grab hover:text-ui-text text-ui-text-muted drag-handle">
                <UIcon name="i-heroicons-bars-2" class="w-5 h-5" />
              </div>
              <div
                class="external-drag flex items-center gap-3 flex-1 min-w-0"
                draggable="true"
                @dragstart="handleDragStart($event, hud.id, 'hud', hud.params)"
              >
                <UIcon
                  :name="
                    standardHuds.find((h) => h.type === hud.baseType)?.icon || 'i-heroicons-photo'
                  "
                  class="w-8 h-8 text-primary shrink-0"
                />
                <div class="flex-1 min-w-0 flex items-center justify-between">
                  <h4 class="text-sm font-medium text-ui-text truncate">{{ hud.name }}</h4>
                  <UButton
                    icon="i-heroicons-trash"
                    color="red"
                    variant="ghost"
                    size="xs"
                    class="opacity-0 group-hover:opacity-100"
                    @click.stop="presetsStore.removePreset(hud.id)"
                  />
                </div>
              </div>
            </div>
          </VueDraggable>
          <div
            v-if="customHuds.length === 0"
            class="text-center text-ui-text-muted py-4 italic text-xs"
          >
            {{ t('common.noData') }}
          </div>
        </CollapsibleEffectGroup>
      </div>
    </div>
  </div>
</template>
