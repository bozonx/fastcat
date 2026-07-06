import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useWorkspaceStore } from './workspace.store';
import { useVfs } from '~/composables/useVfs';
import { createPresetRepository } from '~/repositories/preset.repository';
import { getVideoEffectManifest, getAudioEffectManifest, registerEffect } from '~/effects';
import { getTransitionManifest, registerTransition } from '~/transitions';
import { createDevLogger } from '~/utils/dev-logger';
import {
  createDefaultExportPresets,
  type CustomPreset,
  type ExportSettingsPreset,
} from '~/utils/settings/presets';

const log = createDevLogger('presets.store');

export type { CustomPreset } from '~/utils/settings/presets';

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

  function getPresetRepo() {
    return createPresetRepository({ vfs: useVfs() });
  }

  async function load() {
    const repo = getPresetRepo();

    // 1. Load custom clip presets from individual files
    try {
      const loadedCustom = await repo.loadCustomPresets();
      customPresets.value = loadedCustom;
      customPresets.value.forEach((preset) => registerPresetManifest(preset));
    } catch (err) {
      log.warn('Failed to load custom presets from disk:', err);
    }

    // 2. Load custom export presets from individual files and merge with built-in defaults
    try {
      const loadedExport = await repo.loadExportPresets();
      const defaultExport = createDefaultExportPresets();
      const mergedExportItems = [...defaultExport.items];

      for (const customExport of loadedExport) {
        if (!mergedExportItems.some((item) => item.id === customExport.id)) {
          mergedExportItems.push(customExport);
        }
      }

      if (workspaceStore.userSettings.exportPresets) {
        workspaceStore.userSettings.exportPresets.items = mergedExportItems;
      }
    } catch (err) {
      log.warn('Failed to load custom export presets from disk:', err);
    }

    // 3. Sync UI collapsed state and default text preset ID from user settings
    const presets = workspaceStore.userSettings.presets;
    if (presets) {
      if (presets.defaultTextPresetId) {
        defaultTextPresetId.value = presets.defaultTextPresetId;
      }

      const state = presets.collapsed;
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
    }
  }

  // Save UI collapsed state to user settings
  function saveUiState() {
    void workspaceStore.batchUpdateUserSettings((draft) => {
      draft.presets.custom = []; // Keep legacy field empty to avoid bloating user.settings.json
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

  watch(defaultTextPresetId, () => {
    saveUiState();
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
      saveUiState();
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
          nameKey: undefined,
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
          nameKey: undefined,
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
        nameKey: undefined,
        isCustom: true,
        baseType: preset.baseType,
        defaultParams: { ...baseManifest.defaultParams, ...preset.params },
      });
    }
  }

  async function saveAsPreset(
    category: 'effect' | 'transition' | 'shape' | 'hud' | 'text',
    baseType: string,
    name: string,
    params: Record<string, unknown>,
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

    const repo = getPresetRepo();
    await repo.saveCustomPreset(newPreset);
    saveUiState();
  }

  async function updatePreset(id: string, params: Record<string, unknown>) {
    const preset = customPresets.value.find((p) => p.id === id);
    if (!preset) return;

    preset.params = { ...params };
    registerPresetManifest(preset);
    customPresets.value = [...customPresets.value];

    const repo = getPresetRepo();
    await repo.saveCustomPreset(preset);
  }

  async function renamePreset(id: string, name: string) {
    const preset = customPresets.value.find((p) => p.id === id);
    if (!preset || !name.trim()) return;

    preset.name = name.trim();
    registerPresetManifest(preset);
    customPresets.value = [...customPresets.value];

    const repo = getPresetRepo();
    await repo.saveCustomPreset(preset);
  }

  async function updatePresetsOrder(
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

    const reorderedIds = new Set(reordered.map((preset) => preset.id));
    const untouched = categoryPresets.filter((preset) => !reorderedIds.has(preset.id));
    untouched.forEach((preset, index) => {
      preset.order = reordered.length + index;
    });

    customPresets.value = [...otherPresets, ...reordered, ...untouched];

    const repo = getPresetRepo();
    for (const preset of [...reordered, ...untouched]) {
      await repo.saveCustomPreset(preset);
    }
  }

  async function removePreset(id: string) {
    const target = customPresets.value.find((p) => p.id === id);
    customPresets.value = customPresets.value.filter((p) => p.id !== id);

    if (target) {
      const repo = getPresetRepo();
      await repo.deleteCustomPreset(id, target.category);
    }
  }

  async function saveExportPreset(preset: ExportSettingsPreset) {
    const repo = getPresetRepo();
    await repo.saveExportPreset(preset);

    const items = workspaceStore.userSettings.exportPresets.items;
    const existingIndex = items.findIndex((p) => p.id === preset.id);
    if (existingIndex >= 0) {
      items[existingIndex] = preset;
    } else {
      items.push(preset);
    }
  }

  async function removeExportPreset(id: string) {
    const repo = getPresetRepo();
    await repo.deleteExportPreset(id);

    workspaceStore.userSettings.exportPresets.items =
      workspaceStore.userSettings.exportPresets.items.filter((p) => p.id !== id);
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
    renamePreset,
    updatePresetsOrder,
    removePreset,
    saveExportPreset,
    removeExportPreset,
  };
});
