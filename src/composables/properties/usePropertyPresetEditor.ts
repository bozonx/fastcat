import { ref, watch, computed, type ComputedRef } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { PropertyAction } from '~/components/properties/PropertyActionList.vue';

/** Minimal manifest shape the preset editor needs from effects/transitions. */
export interface PresetManifestLike {
  type: string;
  name?: string;
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
  const selectionStore = useSelectionStore();

  const params = ref<Record<string, unknown>>({});
  const isSaveModalOpen = ref(false);
  const isRenameModalOpen = ref(false);
  const newPresetName = ref('');
  const renamingPresetName = ref('');

  const isRecentlySaved = ref(false);
  let savedTimeout: number | null = null;

  watch(
    opts.source,
    (type) => {
      params.value = opts.manifest.value ? opts.initParams(type) : {};
      isRecentlySaved.value = false;
      if (savedTimeout) {
        window.clearTimeout(savedTimeout);
        savedTimeout = null;
      }
    },
    { immediate: true },
  );

  function handleUpdateParam(key: string, value: unknown) {
    params.value = {
      ...params.value,
      [key]: value,
    };
    isRecentlySaved.value = false;
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

    isRecentlySaved.value = true;
    if (savedTimeout) window.clearTimeout(savedTimeout);
    savedTimeout = window.setTimeout(() => {
      isRecentlySaved.value = false;
    }, 1500);
  }

  function handleRenamePreset() {
    const manifest = opts.manifest.value;
    if (!manifest || !manifest.isCustom || !renamingPresetName.value.trim()) return;
    presetsStore.renamePreset(manifest.type, renamingPresetName.value.trim());
    isRenameModalOpen.value = false;
  }

  function handleDeletePreset() {
    const manifest = opts.manifest.value;
    if (!manifest || !manifest.isCustom) return;
    presetsStore.removePreset(manifest.type);
    selectionStore.clearSelection();
  }

  const actions = computed<PropertyAction[]>(() => {
    const list: PropertyAction[] = [];
    const isCustom = Boolean(opts.manifest.value?.isCustom);

    if (isCustom) {
      list.push({
        id: 'update-preset',
        label: isRecentlySaved.value ? t('common.saved') : t('common.save'),
        icon: isRecentlySaved.value ? 'i-heroicons-check-circle' : 'i-heroicons-check',
        color: isRecentlySaved.value ? 'success' : 'primary',
        onClick: handleUpdatePreset,
      });
    }

    list.push({
      id: 'save-as-preset',
      label: isCustom
        ? t('fastcat.effects.saveAsNew')
        : t('fastcat.effects.saveAsPreset'),
      icon: 'i-heroicons-bookmark',
      color: isCustom ? 'neutral' : 'primary',
      variant: isCustom ? 'soft' : 'solid',
      onClick: () => {
        newPresetName.value = '';
        isSaveModalOpen.value = true;
      },
    });

    if (isCustom) {
      list.push({
        id: 'rename-preset',
        icon: 'i-heroicons-pencil-square',
        color: 'neutral',
        variant: 'ghost',
        title: t('common.rename'),
        onClick: () => {
          renamingPresetName.value = opts.manifest.value?.name || '';
          isRenameModalOpen.value = true;
        },
      });

      list.push({
        id: 'delete-preset',
        icon: 'i-heroicons-trash',
        color: 'danger',
        variant: 'ghost',
        title: t('common.delete'),
        onClick: handleDeletePreset,
      });
    }

    return list;
  });

  return {
    params,
    isSaveModalOpen,
    isRenameModalOpen,
    newPresetName,
    renamingPresetName,
    handleUpdateParam,
    handleSavePreset,
    handleRenamePreset,
    actions,
  };
}
