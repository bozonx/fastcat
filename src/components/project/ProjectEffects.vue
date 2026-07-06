<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { getAllTransitionManifests, getTransitionManifest } from '~/transitions';
import { useSelectionStore } from '~/stores/selection.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAudioPluginsStore } from '~/stores/audio-plugins.store';

import EffectCatalogGroup, {
  type EffectCatalogItem,
} from '~/components/effects/EffectCatalogGroup.vue';
import PresetSaveModal from '~/components/properties/PresetSaveModal.vue';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import { useEffectManifestGroups } from '~/composables/effects/useEffectManifestGroups';

defineProps<{
  compact?: boolean;
}>();

const { t } = useI18n();
const selectionStore = useSelectionStore();
const presetsStore = usePresetsStore();
const workspaceStore = useWorkspaceStore();
const audioPluginsStore = useAudioPluginsStore();

void audioPluginsStore.ensureInit();

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

const { groups: effectGroups } = useEffectManifestGroups('video');
const { groups: audioEffectGroups } = useEffectManifestGroups(
  'audio',
  () => audioPluginsStore.registryVersion,
);

const videoEffects = computed(() => effectGroups.value.standard);
const customEffects = computed(() => effectGroups.value.custom);
const standardAudioEffects = computed(() => audioEffectGroups.value.standard);
const customAudioEffects = computed(() => audioEffectGroups.value.custom);

const basicAudioEffects = computed(() => audioEffectGroups.value.basic);
const nonBasicAudioEffects = computed(() => audioEffectGroups.value.nonBasic);
const transitions = computed(() => getAllTransitionManifests());

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

const selectedEffectType = computed(() => {
  const entity = selectionStore.selectedEntity;
  return entity?.source === 'project' && entity.kind === 'effect' ? entity.effectType : null;
});

const selectedTransitionType = computed(() => {
  const entity = selectionStore.selectedEntity;
  return entity?.source === 'project' && entity.kind === 'transition'
    ? entity.transitionType
    : null;
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

function updateCustomEffectsOrder(newCustomEffects: EffectCatalogItem[]) {
  const orderIds = newCustomEffects.map((e) => e.type);
  presetsStore.updatePresetsOrder('effect', orderIds);
}

function updateCustomTransitionsOrder(newCustomTransitions: EffectCatalogItem[]) {
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
      <div v-show="activeTab === 'video'" class="flex flex-col gap-2.5 pb-2">
        <EffectCatalogGroup
          v-model:is-collapsed="presetsStore.effectsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
          :items="videoEffects"
          :selected-type="selectedEffectType"
          :empty-message="t('common.noData')"
          @pointer-down="(event, item) => handlePointerDown(event, item.type, 'effect')"
          @select="(item) => selectEffect(item.type)"
        />

        <EffectCatalogGroup
          v-model:is-collapsed="presetsStore.effectsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
          :items="customEffects"
          :selected-type="selectedEffectType"
          :empty-message="t('fastcat.effects.noCustomPresets')"
          reorderable
          show-actions
          @pointer-down="(event, item) => handlePointerDown(event, item.type, 'effect')"
          @select="(item) => selectEffect(item.type)"
          @rename="openRenameModal"
          @action="(item) => presetsStore.removePreset(item.type)"
          @update-order="updateCustomEffectsOrder"
        />
      </div>

      <div v-show="activeTab === 'transitions'" class="flex flex-col gap-2.5 pb-2">
        <EffectCatalogGroup
          v-model:is-collapsed="presetsStore.transitionsStandardCollapsed"
          :title="t('fastcat.effects.groups.standard')"
          :items="standardTransitions"
          :selected-type="selectedTransitionType"
          :empty-message="t('common.noData')"
          @pointer-down="(event, item) => handlePointerDown(event, item.type, 'transition')"
          @select="(item) => selectTransition(item.type)"
        />

        <EffectCatalogGroup
          v-model:is-collapsed="presetsStore.transitionsCustomCollapsed"
          :title="t('fastcat.effects.groups.custom')"
          :items="customTransitions"
          :selected-type="selectedTransitionType"
          :empty-message="t('fastcat.effects.noCustomPresets')"
          reorderable
          show-actions
          @pointer-down="(event, item) => handlePointerDown(event, item.type, 'transition')"
          @select="(item) => selectTransition(item.type)"
          @rename="openRenameModal"
          @action="(item) => presetsStore.removePreset(item.type)"
          @update-order="updateCustomTransitionsOrder"
        />
      </div>

      <template v-if="isAudioEffectsEnabled">
        <div v-show="activeTab === 'audio'" class="flex flex-col gap-2.5 pb-2">
          <EffectCatalogGroup
            v-model:is-collapsed="presetsStore.audioStandardCollapsed"
            :title="t('fastcat.effects.groups.standard')"
            :items="basicAudioEffects"
            :selected-type="selectedEffectType"
            :empty-message="standardAudioEffects.length === 0 ? t('common.noData') : undefined"
            @pointer-down="(event, item) => handlePointerDown(event, item.type, 'effect')"
            @select="(item) => selectEffect(item.type)"
          />

          <EffectCatalogGroup
            v-if="nonBasicAudioEffects.length > 0"
            v-model:is-collapsed="presetsStore.audioStandardCollapsed"
            :title="t('fastcat.effects.groups.artistic')"
            :items="nonBasicAudioEffects"
            :selected-type="selectedEffectType"
            @pointer-down="(event, item) => handlePointerDown(event, item.type, 'effect')"
            @select="(item) => selectEffect(item.type)"
          />

          <EffectCatalogGroup
            v-model:is-collapsed="presetsStore.audioCustomCollapsed"
            :title="t('fastcat.effects.groups.custom')"
            :items="customAudioEffects"
            :selected-type="selectedEffectType"
            :empty-message="t('fastcat.effects.noCustomPresets')"
            reorderable
            show-actions
            @pointer-down="(event, item) => handlePointerDown(event, item.type, 'effect')"
            @select="(item) => selectEffect(item.type)"
            @rename="openRenameModal"
            @action="(item) => presetsStore.removePreset(item.type)"
            @update-order="updateCustomEffectsOrder"
          />
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
