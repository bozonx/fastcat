import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useWorkspaceStore } from './workspace.store';
import { getVideoEffectManifest, getAudioEffectManifest, registerEffect } from '~/effects';
import { getTransitionManifest, registerTransition } from '~/transitions';
import {
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';

export interface CustomPreset {
  id: string; // Used as the type in registry
  baseType: string;
  name: string;
  category: 'effect' | 'transition' | 'shape' | 'hud' | 'text';
  effectTarget?: 'video' | 'audio';
  params: Record<string, any>;
  order: number;
}

export const usePresetsStore = defineStore('presets', () => {
  const workspaceStore = useWorkspaceStore();
  const customPresets = ref<CustomPreset[]>([]);

  const defaultTextPresetId = ref<string>('');

  const effectsStandardCollapsed = ref(false);
  const effectsCustomCollapsed = ref(false);
  const transitionsStandardCollapsed = ref(false);
  const transitionsCustomCollapsed = ref(false);
  const audioStandardCollapsed = ref(false);
  const audioCustomCollapsed = ref(false);
  const shapesStandardCollapsed = ref(false);
  const shapesCustomCollapsed = ref(false);
  const hudsStandardCollapsed = ref(false);
  const hudsCustomCollapsed = ref(false);
  const textsStandardCollapsed = ref(false);
  const textsCustomCollapsed = ref(false);

  function load() {
    // Check workspace state (primary source of truth)
    const workspaceCustom = workspaceStore.workspaceState.presets.custom;
    const workspaceDefaultText = workspaceStore.workspaceState.presets.defaultTextPresetId;

    if (workspaceCustom.length > 0) {
      customPresets.value = [...workspaceCustom];
    }

    if (workspaceDefaultText) {
      defaultTextPresetId.value = workspaceDefaultText;
    }

    const state = workspaceStore.workspaceState.presets.collapsed;
    if (state && Object.keys(state).length > 0) {
      effectsStandardCollapsed.value = !!state.effectsStandardCollapsed;
      effectsCustomCollapsed.value = !!state.effectsCustomCollapsed;
      transitionsStandardCollapsed.value = !!state.transitionsStandardCollapsed;
      transitionsCustomCollapsed.value = !!state.transitionsCustomCollapsed;
      audioStandardCollapsed.value = !!state.audioStandardCollapsed;
      audioCustomCollapsed.value = !!state.audioCustomCollapsed;
      shapesStandardCollapsed.value = !!state.shapesStandardCollapsed;
      shapesCustomCollapsed.value = !!state.shapesCustomCollapsed;
      hudsStandardCollapsed.value = !!state.hudsStandardCollapsed;
      hudsCustomCollapsed.value = !!state.hudsCustomCollapsed;
      textsStandardCollapsed.value = !!state.textsStandardCollapsed;
      textsCustomCollapsed.value = !!state.textsCustomCollapsed;
    }

    // Register custom presets
    customPresets.value.forEach((preset) => registerPresetManifest(preset));
  }

  // Save to workspace state
  function savePresets() {
    if (workspaceStore.workspaceHandle) {
      void workspaceStore.batchUpdateWorkspaceState((draft) => {
        draft.presets.custom = JSON.parse(JSON.stringify(customPresets.value));
        draft.presets.defaultTextPresetId = defaultTextPresetId.value;
        draft.presets.collapsed = {
          effectsStandardCollapsed: effectsStandardCollapsed.value,
          effectsCustomCollapsed: effectsCustomCollapsed.value,
          transitionsStandardCollapsed: transitionsStandardCollapsed.value,
          transitionsCustomCollapsed: transitionsCustomCollapsed.value,
          audioStandardCollapsed: audioStandardCollapsed.value,
          audioCustomCollapsed: audioCustomCollapsed.value,
          shapesStandardCollapsed: shapesStandardCollapsed.value,
          shapesCustomCollapsed: shapesCustomCollapsed.value,
          hudsStandardCollapsed: hudsStandardCollapsed.value,
          hudsCustomCollapsed: hudsCustomCollapsed.value,
          textsStandardCollapsed: textsStandardCollapsed.value,
          textsCustomCollapsed: textsCustomCollapsed.value,
        };
      });
    }
  }

  watch(defaultTextPresetId, () => {
    savePresets();
  });

  watch(
    [
      effectsStandardCollapsed,
      effectsCustomCollapsed,
      transitionsStandardCollapsed,
      transitionsCustomCollapsed,
      audioStandardCollapsed,
      audioCustomCollapsed,
      shapesStandardCollapsed,
      shapesCustomCollapsed,
      hudsStandardCollapsed,
      hudsCustomCollapsed,
      textsStandardCollapsed,
      textsCustomCollapsed,
    ],
    () => {
      savePresets();
    },
  );

  // Sync from workspace state when it loads or changes externally
  watch(
    () => workspaceStore.workspaceState.presets,
    (presets) => {
      if (!presets) return;
      
      const { custom: newPresets, defaultTextPresetId: newDefaultText, collapsed: newCollapsed } = presets;

      if (newPresets && newPresets.length > 0) {
        if (JSON.stringify(newPresets) !== JSON.stringify(customPresets.value)) {
          customPresets.value = [...newPresets];
          customPresets.value.forEach((preset) => registerPresetManifest(preset));
        }
      }

      if (newDefaultText !== undefined && newDefaultText !== defaultTextPresetId.value) {
        defaultTextPresetId.value = newDefaultText;
      }

      if (newCollapsed) {
        effectsStandardCollapsed.value = !!newCollapsed.effectsStandardCollapsed;
        effectsCustomCollapsed.value = !!newCollapsed.effectsCustomCollapsed;
        transitionsStandardCollapsed.value = !!newCollapsed.transitionsStandardCollapsed;
        transitionsCustomCollapsed.value = !!newCollapsed.transitionsCustomCollapsed;
        audioStandardCollapsed.value = !!newCollapsed.audioStandardCollapsed;
        audioCustomCollapsed.value = !!newCollapsed.audioCustomCollapsed;
        shapesStandardCollapsed.value = !!newCollapsed.shapesStandardCollapsed;
        shapesCustomCollapsed.value = !!newCollapsed.shapesCustomCollapsed;
        hudsStandardCollapsed.value = !!newCollapsed.hudsStandardCollapsed;
        hudsCustomCollapsed.value = !!newCollapsed.hudsCustomCollapsed;
        textsStandardCollapsed.value = !!newCollapsed.textsStandardCollapsed;
        textsCustomCollapsed.value = !!newCollapsed.textsCustomCollapsed;
      }
    },
    { deep: true },
  );

  function registerPresetManifest(preset: CustomPreset) {
    if (preset.category === 'effect') {
      const target = preset.effectTarget ?? 'video';

      if (target === 'video') {
        const baseManifest = getVideoEffectManifest(preset.baseType);
        if (!baseManifest) return;

        registerEffect({
          ...baseManifest,
          type: preset.id,
          name: preset.name,
          target: 'video',
          isCustom: true,
          baseType: preset.baseType,
          defaultValues: { ...baseManifest.defaultValues, ...preset.params },
        });
      } else if (target === 'audio') {
        const baseManifest = getAudioEffectManifest(preset.baseType);
        if (!baseManifest) return;

        registerEffect({
          ...baseManifest,
          type: preset.id,
          name: preset.name,
          target: 'audio',
          isCustom: true,
          baseType: preset.baseType,
          defaultValues: { ...baseManifest.defaultValues, ...preset.params },
        });
      }
    } else if (preset.category === 'transition') {
      const baseManifest = getTransitionManifest(preset.baseType);
      if (!baseManifest) return;

      registerTransition({
        ...baseManifest,
        type: preset.id,
        name: preset.name,
        isCustom: true,
        baseType: preset.baseType,
        defaultParams: { ...baseManifest.defaultParams, ...preset.params },
      });
    }
  }

  function saveAsPreset(
    category: 'effect' | 'transition' | 'shape' | 'hud' | 'text',
    baseType: string,
    name: string,
    params: Record<string, any>,
    effectTarget?: 'video' | 'audio',
  ) {
    const newPreset: CustomPreset = {
      id: `custom_${category}_${Date.now()}`,
      baseType,
      name,
      category,
      effectTarget: category === 'effect' ? (effectTarget ?? 'video') : undefined,
      params,
      order: customPresets.value.filter((p) => p.category === category).length,
    };

    customPresets.value.push(newPreset);
    registerPresetManifest(newPreset);
    savePresets();
  }

  function updatePreset(id: string, params: Record<string, any>) {
    const preset = customPresets.value.find((p) => p.id === id);
    if (!preset) return;

    preset.params = { ...params };
    registerPresetManifest(preset);
    savePresets();
  }

  function updatePresetsOrder(
    category: 'effect' | 'transition' | 'shape' | 'hud' | 'text',
    newOrderIds: string[],
  ) {
    const categoryPresets = customPresets.value.filter((p) => p.category === category);
    const otherPresets = customPresets.value.filter((p) => p.category !== category);

    const reordered: CustomPreset[] = [];
    newOrderIds.forEach((id, index) => {
      const preset = categoryPresets.find((p) => p.id === id);
      if (preset) {
        preset.order = index;
        reordered.push(preset);
      }
    });

    customPresets.value = [...otherPresets, ...reordered];
    savePresets();
  }

  function removePreset(id: string) {
    customPresets.value = customPresets.value.filter((p) => p.id !== id);
    savePresets();
    // We don't unregister them dynamically here, they will just disappear after reload,
    // or we can just ignore it for the current session since it won't be shown anyway
  }

  return {
    customPresets,
    defaultTextPresetId,
    effectsStandardCollapsed,
    effectsCustomCollapsed,
    transitionsStandardCollapsed,
    transitionsCustomCollapsed,
    audioStandardCollapsed,
    audioCustomCollapsed,
    shapesStandardCollapsed,
    shapesCustomCollapsed,
    hudsStandardCollapsed,
    hudsCustomCollapsed,
    textsStandardCollapsed,
    textsCustomCollapsed,
    load,
    saveAsPreset,
    updatePreset,
    updatePresetsOrder,
    removePreset,
  };
});
