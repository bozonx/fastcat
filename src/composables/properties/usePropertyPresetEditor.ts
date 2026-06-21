import { ref, watch, computed, type ComputedRef } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import type { PropertyAction } from '~/components/properties/PropertyActionList.vue';

/** Minimal manifest shape the preset editor needs from effects/transitions. */
export interface PresetManifestLike {
  type: string;
  baseType?: string;
  isCustom?: boolean;
}

interface PropertyPresetEditorOptions<M extends PresetManifestLike> {
  /** Resolved manifest for the currently-edited effect/transition. */
  manifest: ComputedRef<M | undefined | null>;
  /** Reactive source key (effectType/transitionType) that re-inits params. */
  source: () => string;
  /** Build the initial param map for a given source value. */
  initParams: (type: string) => Record<string, unknown>;
  /** Persist current params as a new named preset. */
  saveAsPreset: (manifest: M, name: string, params: Record<string, unknown>) => void;
}

/**
 * Shared state/behaviour for the project-level effect & transition property
 * editors: live params, the save-preset modal, and the action list. The two
 * `.vue` files differ only in how params are rendered and resolved.
 */
export function usePropertyPresetEditor<M extends PresetManifestLike>(
  opts: PropertyPresetEditorOptions<M>,
) {
  const { t } = useI18n();
  const presetsStore = usePresetsStore();

  const params = ref<Record<string, unknown>>({});
  const isSaveModalOpen = ref(false);
  const newPresetName = ref('');

  watch(
    opts.source,
    (type) => {
      params.value = opts.manifest.value ? opts.initParams(type) : {};
    },
    { immediate: true },
  );

  function handleUpdateParam(key: string, value: unknown) {
    params.value = {
      ...params.value,
      [key]: value,
    };
  }

  function handleSavePreset() {
    const manifest = opts.manifest.value;
    if (!manifest || !newPresetName.value.trim()) return;

    opts.saveAsPreset(manifest, newPresetName.value.trim(), params.value);

    isSaveModalOpen.value = false;
    newPresetName.value = '';
  }

  function handleUpdatePreset() {
    const manifest = opts.manifest.value;
    if (!manifest || !manifest.isCustom) return;
    presetsStore.updatePreset(manifest.type, params.value);
  }

  const actions = computed<PropertyAction[]>(() => {
    const list: PropertyAction[] = [];
    if (opts.manifest.value?.isCustom) {
      list.push({
        id: 'update-preset',
        label: t('common.save'),
        icon: 'i-heroicons-check',
        onClick: handleUpdatePreset,
      });
    }
    list.push({
      id: 'save-as-preset',
      label: opts.manifest.value?.isCustom
        ? t('fastcat.effects.saveAsNew')
        : t('fastcat.effects.saveAsPreset'),
      icon: 'i-heroicons-bookmark',
      onClick: () => (isSaveModalOpen.value = true),
    });
    return list;
  });

  return {
    params,
    isSaveModalOpen,
    newPresetName,
    handleUpdateParam,
    handleSavePreset,
    actions,
  };
}
