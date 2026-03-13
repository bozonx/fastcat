<script setup lang="ts">
import { ref, computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import {
  getAllVideoEffectManifests,
  getAllAudioEffectManifests,
  getEffectManifest,
} from '~/effects';
import type { AudioEffectManifest } from '~/effects';
import { getAllTransitionManifests, getTransitionManifest } from '~/transitions';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';

import CollapsibleEffectGroup from '~/components/common/CollapsibleEffectGroup.vue';
import EffectCard from '~/components/common/EffectCard.vue';

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();

const activeTab = ref<'video' | 'transitions' | 'audio'>('video');

const videoEffects = computed(() => getAllVideoEffectManifests());
const audioEffects = computed(() => getAllAudioEffectManifests());
const standardAudioEffects = computed(() => audioEffects.value.filter((e) => !e.isCustom));
const customAudioEffects = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'effect')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => getEffectManifest(preset.id))
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getEffectManifest>> =>
      Boolean(manifest),
    );

  return presetManifests.filter((manifest) => manifest.target === 'audio');
});

const basicAudioEffects = computed(() =>
  standardAudioEffects.value.filter((effect) => (effect.category ?? 'basic') === 'basic'),
);
const artisticAudioEffects = computed(() =>
  standardAudioEffects.value.filter((effect) => effect.category === 'artistic'),
);
const transitions = computed(() => getAllTransitionManifests());

function hasAudioEffects(effects: AudioEffectManifest<any>[]) {
  return effects.length > 0;
}

const standardEffects = computed(() => videoEffects.value.filter((e) => !e.isCustom));
const customEffects = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'effect')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => getEffectManifest(preset.id))
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
    .map((preset) => getTransitionManifest(preset.id))
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getTransitionManifest>> =>
      Boolean(manifest),
    );

  return presetManifests;
});

function handleDragStart(event: DragEvent, type: string, category: 'effect' | 'transition') {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(`gran-${category}`, type);
  event.dataTransfer.effectAllowed = 'copy';
}

function selectEffect(type: string) {
  selectionStore.selectProjectEffect(type);
}

function selectTransition(type: string) {
  selectionStore.selectProjectTransition(type);
}

function updateCustomEffectsOrder(newCustomEffects: any[]) {
  const orderIds = newCustomEffects.map((e) => e.type);
  presetsStore.updatePresetsOrder('effect', orderIds);
}

function updateCustomTransitionsOrder(newCustomTransitions: any[]) {
  const orderIds = newCustomTransitions.map((t) => t.type);
  presetsStore.updatePresetsOrder('transition', orderIds);
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
          activeTab === 'video'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'video'"
      >
        {{ t('granVideoEditor.effects.tabs.video', 'Video') }}
      </button>
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'transitions'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'transitions'"
      >
        {{ t('granVideoEditor.effects.tabs.transitions', 'Transitions') }}
      </button>
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'audio'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'audio'"
      >
        {{ t('granVideoEditor.effects.tabs.audio', 'Audio') }}
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto bg-ui-bg p-3">
      <!-- Video Effects -->
      <div v-show="activeTab === 'video'" class="flex flex-col gap-4 pb-4">
        <!-- Standard Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
          :title="t('granVideoEditor.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-2">
            <EffectCard
              v-for="effect in standardEffects"
              :key="effect.type"
              :manifest="effect"
              :is-draggable="true"
              :is-selected="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'effect' &&
                selectionStore.selectedEntity.effectType === effect.type
              "
              @dragstart="handleDragStart($event, effect.type, 'effect')"
              @click="selectEffect(effect.type)"
            />
            <div
              v-if="standardEffects.length === 0"
              class="text-center text-ui-text-muted py-4 italic text-xs"
            >
              {{ t('common.noData') }}
            </div>
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
          :title="t('granVideoEditor.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customEffects"
            class="flex flex-col gap-2"
            :animation="150"
            ghost-class="opacity-50"
            handle=".drag-handle"
            filter=".external-drag"
            :prevent-on-filter="false"
            @update:model-value="updateCustomEffectsOrder"
          >
            <div v-for="effect in customEffects" :key="effect.type" class="relative group">
              <div
                class="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab hover:text-ui-text text-ui-text-muted drag-handle opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <UIcon name="i-heroicons-bars-2" class="w-4 h-4" />
              </div>
              <EffectCard
                :manifest="effect"
                :is-draggable="true"
                class="external-drag"
                :is-selected="
                  selectionStore.selectedEntity?.source === 'project' &&
                  selectionStore.selectedEntity.kind === 'effect' &&
                  selectionStore.selectedEntity.effectType === effect.type
                "
                :show-action="true"
                @dragstart="handleDragStart($event, effect.type, 'effect')"
                @click="selectEffect(effect.type)"
                @action="presetsStore.removePreset(effect.type)"
              />
            </div>
          </VueDraggable>
          <div
            v-if="customEffects.length === 0"
            class="text-center text-ui-text-muted py-4 italic text-xs"
          >
            {{ t('common.noData') }}
          </div>
        </CollapsibleEffectGroup>
      </div>

      <!-- Transitions -->
      <div v-show="activeTab === 'transitions'" class="flex flex-col gap-4 pb-4">
        <!-- Standard Transitions -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.transitionsStandardCollapsed"
          :title="t('granVideoEditor.effects.groups.standard')"
        >
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="transition in standardTransitions"
              :key="transition.type"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors"
              :class="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'transition' &&
                selectionStore.selectedEntity.transitionType === transition.type
                  ? 'border-primary bg-primary/10'
                  : 'border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated'
              "
              draggable="true"
              @dragstart="handleDragStart($event, transition.type, 'transition')"
              @click="selectTransition(transition.type)"
            >
              <UIcon :name="transition.icon" class="w-8 h-8 text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <h4 class="text-sm font-medium text-ui-text">{{ transition.name }}</h4>
              </div>
            </div>
            <div
              v-if="standardTransitions.length === 0"
              class="text-center text-ui-text-muted py-4 italic text-xs"
            >
              {{ t('common.noData') }}
            </div>
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Transitions -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.transitionsCustomCollapsed"
          :title="t('granVideoEditor.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customTransitions"
            class="flex flex-col gap-2"
            :animation="150"
            ghost-class="opacity-50"
            handle=".drag-handle"
            filter=".external-drag"
            :prevent-on-filter="false"
            @update:model-value="updateCustomTransitionsOrder"
          >
            <div
              v-for="transition in customTransitions"
              :key="transition.type"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors group"
              :class="
                selectionStore.selectedEntity?.source === 'project' &&
                selectionStore.selectedEntity.kind === 'transition' &&
                selectionStore.selectedEntity.transitionType === transition.type
                  ? 'border-primary bg-primary/10'
                  : 'border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated'
              "
              @click="selectTransition(transition.type)"
            >
              <div class="cursor-grab hover:text-ui-text text-ui-text-muted drag-handle">
                <UIcon name="i-heroicons-bars-2" class="w-5 h-5" />
              </div>
              <div
                class="external-drag flex items-center gap-3 flex-1 min-w-0"
                draggable="true"
                @dragstart="handleDragStart($event, transition.type, 'transition')"
              >
                <UIcon :name="transition.icon" class="w-8 h-8 text-primary shrink-0" />
                <div class="flex-1 min-w-0 flex items-center justify-between">
                  <h4 class="text-sm font-medium text-ui-text truncate">{{ transition.name }}</h4>
                  <UButton
                    icon="i-heroicons-trash"
                    color="red"
                    variant="ghost"
                    size="xs"
                    class="opacity-0 group-hover:opacity-100"
                    @click.stop="presetsStore.removePreset(transition.type)"
                  />
                </div>
              </div>
            </div>
          </VueDraggable>
          <div
            v-if="customTransitions.length === 0"
            class="text-center text-ui-text-muted py-4 italic text-xs"
          >
            {{ t('common.noData') }}
          </div>
        </CollapsibleEffectGroup>
      </div>

      <!-- Audio Effects -->
      <div v-show="activeTab === 'audio'" class="flex flex-col gap-4 pb-4">
        <!-- Standard Audio Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.audioStandardCollapsed"
          :title="t('granVideoEditor.effects.groups.standard')"
        >
          <div class="flex flex-col gap-4">
            <div v-if="hasAudioEffects(basicAudioEffects)">
              <h4 class="text-xs uppercase tracking-wide text-ui-text-muted mb-2">
                {{ t('granVideoEditor.effects.groups.standard', 'Standard') }}
              </h4>
              <div class="grid grid-cols-1 gap-2">
                <EffectCard
                  v-for="effect in basicAudioEffects"
                  :key="effect.type"
                  :manifest="effect"
                  :is-draggable="true"
                  :is-selected="
                    selectionStore.selectedEntity?.source === 'project' &&
                    selectionStore.selectedEntity.kind === 'effect' &&
                    selectionStore.selectedEntity.effectType === effect.type
                  "
                  @dragstart="handleDragStart($event, effect.type, 'effect')"
                  @click="selectEffect(effect.type)"
                />
              </div>
            </div>

            <div v-if="hasAudioEffects(artisticAudioEffects)">
              <h4 class="text-xs uppercase tracking-wide text-ui-text-muted mb-2">
                {{ t('granVideoEditor.effects.groups.artistic', 'Художественные') }}
              </h4>
              <div class="grid grid-cols-1 gap-2">
                <EffectCard
                  v-for="effect in artisticAudioEffects"
                  :key="effect.type"
                  :manifest="effect"
                  :is-draggable="true"
                  :is-selected="
                    selectionStore.selectedEntity?.source === 'project' &&
                    selectionStore.selectedEntity.kind === 'effect' &&
                    selectionStore.selectedEntity.effectType === effect.type
                  "
                  @dragstart="handleDragStart($event, effect.type, 'effect')"
                  @click="selectEffect(effect.type)"
                />
              </div>
            </div>

            <div
              v-if="standardAudioEffects.length === 0"
              class="text-center text-ui-text-muted py-4 italic text-xs"
            >
              {{ t('common.noData') }}
            </div>
          </div>
        </CollapsibleEffectGroup>

        <!-- Custom Audio Effects -->
        <CollapsibleEffectGroup
          v-model:is-collapsed="presetsStore.audioCustomCollapsed"
          :title="t('granVideoEditor.effects.groups.custom')"
        >
          <VueDraggable
            :model-value="customAudioEffects"
            class="flex flex-col gap-2"
            :animation="150"
            ghost-class="opacity-50"
            handle=".drag-handle"
            filter=".external-drag"
            :prevent-on-filter="false"
            @update:model-value="updateCustomEffectsOrder"
          >
            <div v-for="effect in customAudioEffects" :key="effect.type" class="relative group">
              <div
                class="absolute left-1 top-1/2 -translate-y-1/2 z-10 cursor-grab hover:text-ui-text text-ui-text-muted drag-handle opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <UIcon name="i-heroicons-bars-2" class="w-4 h-4" />
              </div>
              <EffectCard
                :manifest="effect"
                :is-draggable="true"
                class="external-drag"
                :is-selected="
                  selectionStore.selectedEntity?.source === 'project' &&
                  selectionStore.selectedEntity.kind === 'effect' &&
                  selectionStore.selectedEntity.effectType === effect.type
                "
                :show-action="true"
                @dragstart="handleDragStart($event, effect.type, 'effect')"
                @click="selectEffect(effect.type)"
                @action="presetsStore.removePreset(effect.type)"
              />
            </div>
          </VueDraggable>
          <div
            v-if="customAudioEffects.length === 0"
            class="text-center text-ui-text-muted py-4 italic text-xs"
          >
            {{ t('common.noData') }}
          </div>
        </CollapsibleEffectGroup>
      </div>
    </div>
  </div>
</template>
