import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { getVideoEffectManifest, getAudioEffectManifest, registerEffect } from '~/effects';
import { getTransitionManifest, registerTransition } from '~/transitions';

export interface CustomPreset {
  id: string; // Used as the type in registry
  baseType: string;
  name: string;
  category: 'effect' | 'transition';
  effectTarget?: 'video' | 'audio';
  params: Record<string, any>;
  order: number;
}

export const usePresetsStore = defineStore('presets', () => {
  const customPresets = ref<CustomPreset[]>([]);

  const effectsStandardCollapsed = ref(false);
  const effectsCustomCollapsed = ref(false);
  const transitionsStandardCollapsed = ref(false);
  const transitionsCustomCollapsed = ref(false);
  const audioStandardCollapsed = ref(false);
  const audioCustomCollapsed = ref(false);

  // Load from localStorage
  function load() {
    try {
      const presetsJson = localStorage.getItem('gran-custom-presets');
      if (presetsJson) {
        customPresets.value = JSON.parse(presetsJson);
      }

      const collapsedJson = localStorage.getItem('gran-presets-collapsed');
      if (collapsedJson) {
        const state = JSON.parse(collapsedJson);
        effectsStandardCollapsed.value = !!state.effectsStandardCollapsed;
        effectsCustomCollapsed.value = !!state.effectsCustomCollapsed;
        transitionsStandardCollapsed.value = !!state.transitionsStandardCollapsed;
        transitionsCustomCollapsed.value = !!state.transitionsCustomCollapsed;
        audioStandardCollapsed.value = !!state.audioStandardCollapsed;
        audioCustomCollapsed.value = !!state.audioCustomCollapsed;
      }

      // Register custom presets
      customPresets.value.forEach((preset) => registerPresetManifest(preset));
    } catch (e) {
      console.error('Failed to load custom presets', e);
    }
  }

  // Save to localStorage
  function savePresets() {
    localStorage.setItem('gran-custom-presets', JSON.stringify(customPresets.value));
  }

  watch(
    [
      effectsStandardCollapsed,
      effectsCustomCollapsed,
      transitionsStandardCollapsed,
      transitionsCustomCollapsed,
      audioStandardCollapsed,
      audioCustomCollapsed,
    ],
    () => {
      localStorage.setItem(
        'gran-presets-collapsed',
        JSON.stringify({
          effectsStandardCollapsed: effectsStandardCollapsed.value,
          effectsCustomCollapsed: effectsCustomCollapsed.value,
          transitionsStandardCollapsed: transitionsStandardCollapsed.value,
          transitionsCustomCollapsed: transitionsCustomCollapsed.value,
          audioStandardCollapsed: audioStandardCollapsed.value,
          audioCustomCollapsed: audioCustomCollapsed.value,
        }),
      );
    },
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
    category: 'effect' | 'transition',
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

  function updatePresetsOrder(category: 'effect' | 'transition', newOrderIds: string[]) {
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
    effectsStandardCollapsed,
    effectsCustomCollapsed,
    transitionsStandardCollapsed,
    transitionsCustomCollapsed,
    audioStandardCollapsed,
    audioCustomCollapsed,
    load,
    saveAsPreset,
    updatePreset,
    updatePresetsOrder,
    removePreset,
  };
});
