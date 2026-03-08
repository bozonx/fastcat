<script setup lang="ts">
import { ref, computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { getAllEffectManifests, getEffectManifest } from '~/effects';
import { getAllTransitionManifests } from '~/transitions';
import { getTransitionManifest } from '~/transitions';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();

const activeTab = ref<'video' | 'transitions' | 'audio'>('video');

const effects = computed(() => getAllEffectManifests());
const transitions = computed(() => getAllTransitionManifests());

const standardEffects = computed(() => effects.value.filter(e => !e.isCustom));
const customEffects = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'effect')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => getEffectManifest(preset.id))
    .filter((manifest): manifest is NonNullable<ReturnType<typeof getEffectManifest>> => Boolean(manifest));

  return presetManifests;
});

const standardTransitions = computed(() => transitions.value.filter(t => !t.isCustom));
const customTransitions = computed(() => {
  const presetManifests = presetsStore.customPresets
    .filter((preset) => preset.category === 'transition')
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => getTransitionManifest(preset.id))
    .filter(
      (manifest): manifest is NonNullable<ReturnType<typeof getTransitionManifest>> => Boolean(manifest),
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
  const orderIds = newCustomEffects.map(e => e.type);
  presetsStore.updatePresetsOrder('effect', orderIds);
}

function updateCustomTransitionsOrder(newCustomTransitions: any[]) {
  const orderIds = newCustomTransitions.map(t => t.type);
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
        <div>
          <button 
            class="flex items-center gap-2 w-full text-left font-medium text-ui-text mb-2 group"
            @click="presetsStore.effectsStandardCollapsed = !presetsStore.effectsStandardCollapsed"
          >
            <UIcon 
              :name="presetsStore.effectsStandardCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'" 
              class="w-4 h-4 text-ui-text-muted group-hover:text-ui-text transition-colors" 
            />
            {{ t('granVideoEditor.effects.groups.standard', 'Standard') }}
          </button>
          
          <div v-show="!presetsStore.effectsStandardCollapsed" class="grid grid-cols-1 gap-2 pl-6">
            <div
              v-for="effect in standardEffects"
              :key="effect.type"
              class="flex items-start gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors"
              :class="
                selectionStore.selectedEntity?.source === 'project' && selectionStore.selectedEntity.kind === 'effect' && selectionStore.selectedEntity.effectType === effect.type
                  ? 'border-primary bg-primary/10'
                  : 'border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated'
              "
              draggable="true"
              @dragstart="handleDragStart($event, effect.type, 'effect')"
              @click="selectEffect(effect.type)"
            >
              <UIcon :name="effect.icon" class="w-8 h-8 text-primary shrink-0" />
              <div class="flex-1 min-w-0">
                <h4 class="text-sm font-medium text-ui-text">{{ effect.name }}</h4>
                <p class="text-xs text-ui-text-muted mt-1 line-clamp-2" :title="effect.description">
                  {{ effect.description }}
                </p>
              </div>
            </div>
            <div v-if="standardEffects.length === 0" class="text-center text-ui-text-muted py-4 italic text-xs">
              {{ t('common.noData') }}
            </div>
          </div>
        </div>

        <!-- Custom Effects -->
        <div>
          <button 
            class="flex items-center gap-2 w-full text-left font-medium text-ui-text mb-2 group"
            @click="presetsStore.effectsCustomCollapsed = !presetsStore.effectsCustomCollapsed"
          >
            <UIcon 
              :name="presetsStore.effectsCustomCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'" 
              class="w-4 h-4 text-ui-text-muted group-hover:text-ui-text transition-colors" 
            />
            {{ t('granVideoEditor.effects.groups.custom', 'Custom') }}
          </button>
          
          <div v-show="!presetsStore.effectsCustomCollapsed" class="pl-6">
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
              <div
                v-for="effect in customEffects"
                :key="effect.type"
                class="flex items-start gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors"
                :class="
                  selectionStore.selectedEntity?.source === 'project' && selectionStore.selectedEntity.kind === 'effect' && selectionStore.selectedEntity.effectType === effect.type
                    ? 'border-primary bg-primary/10'
                    : 'border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated'
                "
                @click="selectEffect(effect.type)"
              >
                <div class="cursor-grab hover:text-ui-text text-ui-text-muted mt-1 drag-handle">
                  <UIcon name="i-heroicons-bars-2" class="w-5 h-5" />
                </div>
                <div
                  class="external-drag flex items-start gap-3 flex-1 min-w-0"
                  draggable="true"
                  @dragstart="handleDragStart($event, effect.type, 'effect')"
                >
                  <UIcon :name="effect.icon" class="w-8 h-8 text-primary shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                      <h4 class="text-sm font-medium text-ui-text truncate">{{ effect.name }}</h4>
                      <UButton
                        icon="i-heroicons-trash"
                        color="red"
                        variant="ghost"
                        size="xs"
                        class="opacity-0 group-hover:opacity-100"
                        @click.stop="presetsStore.removePreset(effect.type)"
                      />
                    </div>
                    <p class="text-xs text-ui-text-muted mt-1 line-clamp-2" :title="effect.description">
                      {{ effect.description }}
                    </p>
                  </div>
                </div>
              </div>
            </VueDraggable>
            <div v-if="customEffects.length === 0" class="text-center text-ui-text-muted py-4 italic text-xs">
              {{ t('common.noData') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Transitions -->
      <div v-show="activeTab === 'transitions'" class="flex flex-col gap-4 pb-4">
        <!-- Standard Transitions -->
        <div>
          <button 
            class="flex items-center gap-2 w-full text-left font-medium text-ui-text mb-2 group"
            @click="presetsStore.transitionsStandardCollapsed = !presetsStore.transitionsStandardCollapsed"
          >
            <UIcon 
              :name="presetsStore.transitionsStandardCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'" 
              class="w-4 h-4 text-ui-text-muted group-hover:text-ui-text transition-colors" 
            />
            {{ t('granVideoEditor.effects.groups.standard', 'Standard') }}
          </button>
          
          <div v-show="!presetsStore.transitionsStandardCollapsed" class="grid grid-cols-1 gap-2 pl-6">
            <div
              v-for="transition in standardTransitions"
              :key="transition.type"
              class="flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors"
              :class="
                selectionStore.selectedEntity?.source === 'project' && selectionStore.selectedEntity.kind === 'transition' && selectionStore.selectedEntity.transitionType === transition.type
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
            <div v-if="standardTransitions.length === 0" class="text-center text-ui-text-muted py-4 italic text-xs">
              {{ t('common.noData') }}
            </div>
          </div>
        </div>

        <!-- Custom Transitions -->
        <div>
          <button 
            class="flex items-center gap-2 w-full text-left font-medium text-ui-text mb-2 group"
            @click="presetsStore.transitionsCustomCollapsed = !presetsStore.transitionsCustomCollapsed"
          >
            <UIcon 
              :name="presetsStore.transitionsCustomCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-down'" 
              class="w-4 h-4 text-ui-text-muted group-hover:text-ui-text transition-colors" 
            />
            {{ t('granVideoEditor.effects.groups.custom', 'Custom') }}
          </button>
          
          <div v-show="!presetsStore.transitionsCustomCollapsed" class="pl-6">
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
                  selectionStore.selectedEntity?.source === 'project' && selectionStore.selectedEntity.kind === 'transition' && selectionStore.selectedEntity.transitionType === transition.type
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
            <div v-if="customTransitions.length === 0" class="text-center text-ui-text-muted py-4 italic text-xs">
              {{ t('common.noData') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Audio Effects -->
      <div
        v-show="activeTab === 'audio'"
        class="flex flex-col items-center justify-center h-full min-h-50 text-ui-text-disabled py-8 text-center"
      >
        <UIcon name="i-heroicons-musical-note" class="w-10 h-10 mb-3" />
        <p class="text-sm italic">
          {{ t('common.noData', '(coming soon)') }}
        </p>
      </div>
    </div>
  </div>
</template>
