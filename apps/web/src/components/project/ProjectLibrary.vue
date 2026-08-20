<script setup lang="ts">
import { computed, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { ShapeType, HudType } from '~/timeline/types';
import { getCustomPresetsByCategory } from '~/utils/presets';
import CollapsibleEffectGroup from '~/components/effects/CollapsibleEffectGroup.vue';
import EffectCard from '~/components/effects/EffectCard.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import { useDraggedFile } from '~/composables/useDraggedFile';

const { setDraggedFile, clearDraggedFile } = useDraggedFile();

defineProps<{
  compact?: boolean;
}>();

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();
const workspaceStore = useWorkspaceStore();
const isHudFeatureEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

const isRenameModalOpen = ref(false);
const renamingPresetId = ref<string | null>(null);
const renamingPresetName = ref('');

function openRenameModal(preset: { id: string; name: string }) {
  renamingPresetId.value = preset.id;
  renamingPresetName.value = preset.name;
  isRenameModalOpen.value = true;
}

function confirmRenamePreset() {
  if (renamingPresetId.value && renamingPresetName.value.trim()) {
    presetsStore.renamePreset(renamingPresetId.value, renamingPresetName.value.trim());
  }
  isRenameModalOpen.value = false;
  renamingPresetId.value = null;
}

const uiStore = useUiStore();
const activeTab = computed({
  get: () => uiStore.activeLibraryTab,
  set: (val) => (uiStore.activeLibraryTab = val),
});

watch(
  isHudFeatureEnabled,
  (enabled) => {
    if (!enabled && activeTab.value === 'hud') activeTab.value = 'texts';
  },
  { immediate: true },
);

const standardTexts = [
  {
    type: 'default',
    name: 'Default',
    icon: 'i-heroicons-document-text',
    params: {
      text: t('fastcat.timeline.textClipDefaultText'),
      style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif' },
    },
  },
  {
    type: 'title',
    name: 'Title',
    icon: 'i-heroicons-h1',
    params: {
      text: 'TITLE',
      style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif' },
    },
  },
  {
    type: 'subtitle',
    name: 'Subtitle',
    icon: 'i-heroicons-h2',
    params: {
      text: 'Subtitle',
      style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif' },
    },
  },
];

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

const customTexts = computed(() => getCustomPresetsByCategory(presetsStore.customPresets, 'text'));

const customShapes = computed(() =>
  getCustomPresetsByCategory(presetsStore.customPresets, 'shape'),
);

const customHuds = computed(() => getCustomPresetsByCategory(presetsStore.customPresets, 'hud'));

function handlePointerDown(
  event: PointerEvent,
  type: string,
  category: 'shape' | 'hud' | 'text',
  presetParams?: Record<string, unknown>,
) {
  const libraryPayload = { kind: category, name: type, path: '', type, presetParams };
  // Lightweight descriptor for the timeline drag-preview ghost.
  setDraggedFile({ kind: category, name: type, path: '' });
  armPointerDnd(event, {
    payload: { source: 'library', data: libraryPayload, preview: { label: type } },
    onEnd: () => clearDraggedFile(),
  });
}

function updateCustomTextsOrder(newCustomTexts: CustomPreset[]) {
  presetsStore.updatePresetsOrder(
    'text',
    newCustomTexts.map((s) => s.id),
  );
}

function updateCustomShapesOrder(newCustomShapes: CustomPreset[]) {
  presetsStore.updatePresetsOrder(
    'shape',
    newCustomShapes.map((s) => s.id),
  );
}

function updateCustomHudsOrder(newCustomHuds: CustomPreset[]) {
  presetsStore.updatePresetsOrder(
    'hud',
    newCustomHuds.map((h) => h.id),
  );
}

function selectItem(
  kind: 'text' | 'shape' | 'hud',
  id: string,
  presetParams?: Record<string, unknown>,
) {
  selectionStore.selectProjectLibraryItem(kind, id, presetParams);
}

function isSelected(kind: 'text' | 'shape' | 'hud', id: string) {
  return (
    selectionStore.selectedEntity?.source === 'project' &&
    selectionStore.selectedEntity.kind === 'library-item' &&
    selectionStore.selectedEntity.itemKind === kind &&
    selectionStore.selectedEntity.itemId === id
  );
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated text-sm relative min-h-0 select-none">
    <!-- Tabs -->
    <div
      class="flex items-center border-b border-ui-border shrink-0 px-1 py-1 gap-0.5 bg-ui-bg-elevated sticky top-0 z-10 min-h-[36px]"
    >
      <button
        class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0 text-2xs font-semibold tracking-wide"
        :class="
          activeTab === 'texts'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'texts'"
      >
        {{ t('fastcat.library.tabs.texts') }}
      </button>
      <button
        class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0 text-2xs font-semibold tracking-wide"
        :class="
          activeTab === 'shapes'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'shapes'"
      >
        {{ t('fastcat.library.tabs.shapes') }}
      </button>
      <button
        v-if="isHudFeatureEnabled"
        class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0 text-2xs font-semibold tracking-wide"
        :class="
          activeTab === 'hud'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'hud'"
      >
        {{ t('fastcat.library.tabs.hud') }}
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-2 py-2 space-y-2.5 custom-scrollbar bg-ui-bg-elevated">
      <!-- Texts -->
      <div v-show="activeTab === 'texts'" class="flex flex-col gap-2.5 pb-2">
        <!-- Standard Texts -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.textsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-1">
            <EffectCard
              v-for="text in standardTexts"
              :key="text.type"
              :title="t(`fastcat.library.texts.${text.type}`, text.name)"
              :icon="text.icon"
              :is-selected="isSelected('text', text.type)"
              :is-draggable="true"
              :show-default-star="true"
              :is-default="presetsStore.defaultTextPresetId === text.type"
              @pointer-down="handlePointerDown($event, text.type, 'text', text.params)"
              @click="selectItem('text', text.type, text.params)"
              @toggle-default="presetsStore.defaultTextPresetId = text.type"
            />
            <UiEmptyState v-if="standardTexts.length === 0" :message="t('common.noData')" />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Texts -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.textsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customTexts"
            class="flex flex-col gap-1"
            :animation="150"
            ghost-class="opacity-50"
            filter="button"
            :prevent-on-filter="false"
            @update:model-value="updateCustomTextsOrder"
          >
            <EffectCard
              v-for="text in customTexts"
              :key="text.id"
              :title="text.name"
              :icon="
                standardTexts.find((s) => s.type === text.baseType)?.icon ||
                'i-heroicons-document-text'
              "
              :is-selected="isSelected('text', text.id)"
              :is-draggable="true"
              :show-default-star="true"
              :is-default="presetsStore.defaultTextPresetId === text.id"
              :show-rename="true"
              :show-action="true"
              @pointer-down="handlePointerDown($event, text.id, 'text', text.params)"
              @click="selectItem('text', text.id, text.params)"
              @toggle-default="presetsStore.defaultTextPresetId = text.id"
              @rename="openRenameModal(text)"
              @action="presetsStore.removePreset(text.id)"
            />
          </VueDraggable>
          <UiEmptyState
            v-if="customTexts.length === 0"
            :message="t('fastcat.library.noCustomPresets')"
          />
        </CollapsibleEffectGroup>
      </div>

      <!-- Shapes -->
      <div v-show="activeTab === 'shapes'" class="flex flex-col gap-2.5 pb-2">
        <!-- Standard Shapes -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.shapesStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-1">
            <EffectCard
              v-for="shape in standardShapes"
              :key="shape.type"
              :title="t(`fastcat.library.shapes.${shape.type}`, shape.name)"
              :icon="shape.icon"
              :is-selected="isSelected('shape', shape.type)"
              :is-draggable="true"
              @pointer-down="handlePointerDown($event, shape.type, 'shape')"
              @click="selectItem('shape', shape.type)"
            />
            <UiEmptyState v-if="standardShapes.length === 0" :message="t('common.noData')" />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Shapes -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.shapesCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customShapes"
            class="flex flex-col gap-1"
            :animation="150"
            ghost-class="opacity-50"
            filter="button"
            :prevent-on-filter="false"
            @update:model-value="updateCustomShapesOrder"
          >
            <EffectCard
              v-for="shape in customShapes"
              :key="shape.id"
              :title="shape.name"
              :icon="
                standardShapes.find((s) => s.type === shape.baseType)?.icon || 'i-heroicons-stop'
              "
              :is-selected="isSelected('shape', shape.id)"
              :is-draggable="true"
              :show-rename="true"
              :show-action="true"
              @pointer-down="handlePointerDown($event, shape.id, 'shape', shape.params)"
              @click="selectItem('shape', shape.id, shape.params)"
              @rename="openRenameModal(shape)"
              @action="presetsStore.removePreset(shape.id)"
            />
          </VueDraggable>
          <UiEmptyState
            v-if="customShapes.length === 0"
            :message="t('fastcat.library.noCustomPresets')"
          />
        </CollapsibleEffectGroup>
      </div>

      <!-- HUDs -->
      <div
        v-if="isHudFeatureEnabled"
        v-show="activeTab === 'hud'"
        class="flex flex-col gap-2.5 pb-2"
      >
        <!-- Standard HUDs -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.hudsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-1">
            <EffectCard
              v-for="hud in standardHuds"
              :key="hud.type"
              :title="t(`fastcat.library.huds.${hud.type}`, hud.name)"
              :icon="hud.icon"
              :is-selected="isSelected('hud', hud.type)"
              :is-draggable="true"
              @pointer-down="handlePointerDown($event, hud.type, 'hud')"
              @click="selectItem('hud', hud.type)"
            />
            <UiEmptyState v-if="standardHuds.length === 0" :message="t('common.noData')" />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom HUDs -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.hudsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customHuds"
            class="flex flex-col gap-1"
            :animation="150"
            ghost-class="opacity-50"
            filter="button"
            :prevent-on-filter="false"
            @update:model-value="updateCustomHudsOrder"
          >
            <EffectCard
              v-for="hud in customHuds"
              :key="hud.id"
              :title="hud.name"
              :icon="standardHuds.find((h) => h.type === hud.baseType)?.icon || 'i-heroicons-photo'"
              :is-selected="isSelected('hud', hud.id)"
              :is-draggable="true"
              :show-rename="true"
              :show-action="true"
              @pointer-down="handlePointerDown($event, hud.id, 'hud', hud.params)"
              @click="selectItem('hud', hud.id, hud.params)"
              @rename="openRenameModal(hud)"
              @action="presetsStore.removePreset(hud.id)"
            />
          </VueDraggable>
          <UiEmptyState
            v-if="customHuds.length === 0"
            :message="t('fastcat.library.noCustomPresets')"
          />
        </CollapsibleEffectGroup>
      </div>
    </div>

    <PresetSaveModal
      v-model:open="isRenameModalOpen"
      v-model:name="renamingPresetName"
      @save="confirmRenamePreset"
    />
  </div>
</template>
