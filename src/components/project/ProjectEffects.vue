<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import {
  getAllVideoEffectManifests,
  getAllAudioEffectManifests,
  getEffectManifest,
} from '~/effects';
import type { AudioEffectManifest, EffectManifest } from '~/effects';
import type { TransitionManifest } from '~/transitions';
import { getAllTransitionManifests, getTransitionManifest } from '~/transitions';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

import CollapsibleEffectGroup from '~/components/effects/CollapsibleEffectGroup.vue';
import EffectCard from '~/components/effects/EffectCard.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';

defineProps<{
  compact?: boolean;
}>();

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();
const workspaceStore = useWorkspaceStore();

const isRenameModalOpen = ref(false);
const renamingPresetId = ref<string | null>(null);
const renamingPresetName = ref('');

function openRenameModal(item: { type: string; name?: string }) {
  renamingPresetId.value = item.type;
  renamingPresetName.value = item.name || '';
  isRenameModalOpen.value = true;
}

function confirmRenamePreset() {
  if (renamingPresetId.value && renamingPresetName.value.trim()) {
    presetsStore.renamePreset(renamingPresetId.value, renamingPresetName.value.trim());
  }
  isRenameModalOpen.value = false;
  renamingPresetId.value = null;
}

const activeTab = ref<'video' | 'transitions' | 'audio'>('video');

const isAudioEffectsEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

watch(isAudioEffectsEnabled, (enabled) => {
  if (!enabled && activeTab.value === 'audio') {
    activeTab.value = 'video';
  }
});

const videoEffects = computed(() =>
  getAllVideoEffectManifests().filter(
    (m) => !m.experimental || workspaceStore.inDevelopmentFeaturesEnabled,
  ),
);
const audioEffects = computed(() =>
  getAllAudioEffectManifests().filter(
    (m) => !m.experimental || workspaceStore.inDevelopmentFeaturesEnabled,
  ),
);
const standardAudioEffects = computed(() => audioEffects.value.filter((e) => !e.isCustom));
const customAudioEffects = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'effect')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => {
      const manifest = getEffectManifest(preset.id);
      if (!manifest) return null;
      return { ...manifest, name: preset.name };
    })
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getEffectManifest>> =>
      Boolean(manifest),
    );

  return presetManifests.filter((manifest) => manifest.target === 'audio');
});

const basicAudioEffects = computed(() =>
  standardAudioEffects.value.filter((effect) => (effect.category ?? 'basic') === 'basic'),
);
const nonBasicAudioEffects = computed(() =>
  standardAudioEffects.value.filter((effect) => (effect.category ?? 'basic') !== 'basic'),
);
const transitions = computed(() => getAllTransitionManifests());

function hasAudioEffects(effects: AudioEffectManifest[]) {
  return effects.length > 0;
}

const standardEffects = computed(() => videoEffects.value.filter((e) => !e.isCustom));
const customEffects = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'effect')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => {
      const manifest = getEffectManifest(preset.id);
      if (!manifest) return null;
      return { ...manifest, name: preset.name };
    })
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getEffectManifest>> =>
      Boolean(manifest),
    );

  return presetManifests.filter((manifest) => (manifest.target ?? 'video') === 'video');
});

const standardTransitions = computed(() => transitions.value.filter((t) => !t.isCustom));
const customTransitions = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'transition')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => {
      const manifest = getTransitionManifest(preset.id);
      if (!manifest) return null;
      return { ...manifest, name: preset.name };
    })
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getTransitionManifest>> =>
      Boolean(manifest),
    );

  return presetManifests;
});

function handlePointerDown(event: PointerEvent, type: string, category: 'effect' | 'transition') {
  armPointerDnd(event, {
    payload: { source: category, data: { type }, preview: { label: type } },
  });
}

function selectEffect(type: string) {
  selectionStore.selectProjectEffect(type);
}

function selectTransition(type: string) {
  selectionStore.selectProjectTransition(type);
}

function updateCustomEffectsOrder(newCustomEffects: EffectManifest[]) {
  const orderIds = newCustomEffects.map((e) => e.type);
  presetsStore.updatePresetsOrder('effect', orderIds);
}

function updateCustomTransitionsOrder(newCustomTransitions: TransitionManifest[]) {
  const orderIds = newCustomTransitions.map((t) => t.type);
  presetsStore.updatePresetsOrder('transition', orderIds);
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
          activeTab === 'video'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'video'"
      >
        {{ t('fastcat.effects.tabs.video') }}
      </button>
      <button
        class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0 text-2xs font-semibold tracking-wide"
        :class="
          activeTab === 'transitions'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'transitions'"
      >
        {{ t('fastcat.effects.tabs.transitions') }}
      </button>
      <button
        v-if="isAudioEffectsEnabled"
        class="group relative flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 shrink-0 text-2xs font-semibold tracking-wide"
        :class="
          activeTab === 'audio'
            ? 'bg-selection-accent-500/15 text-selection-accent-400'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/40'
        "
        @click="activeTab = 'audio'"
      >
        {{ t('fastcat.effects.tabs.audio') }}
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-2 py-2 space-y-2.5 custom-scrollbar bg-ui-bg-elevated">
      <!-- Video Effects -->
      <div v-show="activeTab === 'video'" class="flex flex-col gap-2.5 pb-2">
        <!-- Standard Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-1">
            <EffectCard
              v-for="effect in standardEffects"
              :key="effect.type"
              :manifest="effect"
              :is-selected="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'effect' &&
                selectionStore.selectedEntity.effectType === effect.type
              "
              :is-draggable="true"
              @pointer-down="handlePointerDown($event, effect.type, 'effect')"
              @click="selectEffect(effect.type)"
            />
            <UiEmptyState v-if="standardEffects.length === 0" :message="t('common.noData')" />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customEffects"
            class="flex flex-col gap-1"
            :animation="150"
            ghost-class="opacity-50"
            filter="button"
            :prevent-on-filter="false"
            @update:model-value="updateCustomEffectsOrder"
          >
            <EffectCard
              v-for="effect in customEffects"
              :key="effect.type"
              :manifest="effect"
              :is-selected="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'effect' &&
                selectionStore.selectedEntity.effectType === effect.type
              "
              :show-action="true"
              :show-rename="true"
              :is-draggable="true"
              @pointer-down="handlePointerDown($event, effect.type, 'effect')"
              @click="selectEffect(effect.type)"
              @rename="openRenameModal(effect)"
              @action="presetsStore.removePreset(effect.type)"
            />
          </VueDraggable>
          <UiEmptyState
            v-if="customEffects.length === 0"
            :message="t('fastcat.effects.noCustomPresets')"
          />
        </CollapsibleEffectGroup>
      </div>

      <!-- Transitions -->
      <div v-show="activeTab === 'transitions'" class="flex flex-col gap-2.5 pb-2">
        <!-- Standard Transitions -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.transitionsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-1">
            <EffectCard
              v-for="transition in standardTransitions"
              :key="transition.type"
              :title="transition.nameKey ? t(transition.nameKey) : transition.name"
              :icon="transition.icon"
              :is-selected="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'transition' &&
                selectionStore.selectedEntity.transitionType === transition.type
              "
              :is-draggable="true"
              @pointer-down="handlePointerDown($event, transition.type, 'transition')"
              @click="selectTransition(transition.type)"
            />
            <UiEmptyState v-if="standardTransitions.length === 0" :message="t('common.noData')" />
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Transitions -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.transitionsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customTransitions"
            class="flex flex-col gap-1"
            :animation="150"
            ghost-class="opacity-50"
            filter="button"
            :prevent-on-filter="false"
            @update:model-value="updateCustomTransitionsOrder"
          >
            <EffectCard
              v-for="transition in customTransitions"
              :key="transition.type"
              :title="transition.nameKey ? t(transition.nameKey) : transition.name"
              :icon="transition.icon"
              :is-selected="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'transition' &&
                selectionStore.selectedEntity.transitionType === transition.type
              "
              :is-draggable="true"
              :show-rename="true"
              :show-action="true"
              @pointer-down="handlePointerDown($event, transition.type, 'transition')"
              @click="selectTransition(transition.type)"
              @rename="openRenameModal(transition)"
              @action="presetsStore.removePreset(transition.type)"
            />
          </VueDraggable>
          <UiEmptyState
            v-if="customTransitions.length === 0"
            :message="t('fastcat.effects.noCustomPresets')"
          />
        </CollapsibleEffectGroup>
      </div>

      <template v-if="isAudioEffectsEnabled">
        <!-- Audio Effects -->
        <div v-show="activeTab === 'audio'" class="flex flex-col gap-2.5 pb-2">
          <!-- Standard Audio Effects -->
          <CollapsibleEffectGroup
            v-model:is-collapsed="presetsStore.audioStandardCollapsed"
            :title="t('fastcat.effects.groups.standard')"
          >
            <div class="flex flex-col gap-2">
              <div v-if="hasAudioEffects(basicAudioEffects)">
                <div class="grid grid-cols-1 gap-1">
                  <EffectCard
                    v-for="effect in basicAudioEffects"
                    :key="effect.type"
                    :manifest="effect"
                    :is-selected="
                      selectionStore.selectedEntity?.source === 'project' &&
                      selectionStore.selectedEntity.kind === 'effect' &&
                      selectionStore.selectedEntity.effectType === effect.type
                    "
                    :is-draggable="true"
                    @pointer-down="handlePointerDown($event, effect.type, 'effect')"
                    @click="selectEffect(effect.type)"
                  />
                </div>
              </div>

              <div v-if="hasAudioEffects(nonBasicAudioEffects)">
                <h4
                  class="text-2xs tracking-wider font-semibold text-ui-text-muted mb-1 mt-1"
                >
                  {{ t('fastcat.effects.groups.artistic') }}
                </h4>
                <div class="grid grid-cols-1 gap-1">
                  <EffectCard
                    v-for="effect in nonBasicAudioEffects"
                    :key="effect.type"
                    :manifest="effect"
                    :is-selected="
                      selectionStore.selectedEntity?.source === 'project' &&
                      selectionStore.selectedEntity.kind === 'effect' &&
                      selectionStore.selectedEntity.effectType === effect.type
                    "
                    :is-draggable="true"
                    @pointer-down="handlePointerDown($event, effect.type, 'effect')"
                    @click="selectEffect(effect.type)"
                  />
                </div>
              </div>

              <UiEmptyState
                v-if="standardAudioEffects.length === 0"
                :message="t('common.noData')"
              />
            </div>
          </CollapsibleEffectGroup>

          <!-- Custom Audio Effects -->
          <CollapsibleEffectGroup
            v-model:is-collapsed="presetsStore.audioCustomCollapsed"
            :title="t('fastcat.effects.groups.custom')"
          >
            <VueDraggable
              :model-value="customAudioEffects"
              class="flex flex-col gap-1"
              :animation="150"
              ghost-class="opacity-50"
              filter="button"
              :prevent-on-filter="false"
              @update:model-value="updateCustomEffectsOrder"
            >
              <EffectCard
                v-for="effect in customAudioEffects"
                :key="effect.type"
                :manifest="effect"
                :is-selected="
                  selectionStore.selectedEntity?.source === 'project' &&
                  selectionStore.selectedEntity.kind === 'effect' &&
                  selectionStore.selectedEntity.effectType === effect.type
                "
                :show-action="true"
                :show-rename="true"
                :is-draggable="true"
                @pointer-down="handlePointerDown($event, effect.type, 'effect')"
                @click="selectEffect(effect.type)"
                @rename="openRenameModal(effect)"
                @action="presetsStore.removePreset(effect.type)"
              />
            </VueDraggable>
            <UiEmptyState
              v-if="customAudioEffects.length === 0"
              :message="t('fastcat.effects.noCustomPresets')"
            />
          </CollapsibleEffectGroup>
        </div>
      </template>
    </div>

    <PresetSaveModal
      v-model:open="isRenameModalOpen"
      v-model:name="renamingPresetName"
      @save="confirmRenamePreset"
    />
  </div>
</template>
