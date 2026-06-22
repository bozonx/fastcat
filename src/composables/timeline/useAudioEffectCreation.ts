import { ref } from 'vue';
import { getAudioEffectManifest } from '~/effects';
import type { ClipEffect } from '~/timeline/types';

export interface UseAudioEffectCreationOptions {
  /** Prefix for generated effect IDs, e.g. `master_effect` or `audio_effect`. */
  effectIdPrefix: string;
  /** Returns the current list of audio effects to extend. */
  getEffects: () => ClipEffect[];
  /** Applies the new list of effects after the selected one is appended. */
  applyEffects: (effects: ClipEffect[]) => void;
}

/**
 * Shared logic for "add audio effect" flow: open the selection modal, create the
 * new effect from its manifest, append it to the current list, then open the editor.
 */
export function useAudioEffectCreation(options: UseAudioEffectCreationOptions) {
  const isSelectEffectModalOpen = ref(false);
  const isEffectsModalOpen = ref(false);

  function openSelectEffect() {
    isSelectEffectModalOpen.value = true;
  }

  function openEffectsEditor() {
    isEffectsModalOpen.value = true;
  }

  function handleSelectEffect(type: string) {
    const manifest = getAudioEffectManifest(type);
    if (!manifest) return;

    const newEffect = {
      id: `${options.effectIdPrefix}_${Date.now()}`,
      type,
      enabled: true,
      target: 'audio' as const,
      ...(manifest.defaultValues || {}),
    };

    options.applyEffects([...options.getEffects(), newEffect as ClipEffect]);

    isSelectEffectModalOpen.value = false;
    isEffectsModalOpen.value = true;
  }

  return {
    isSelectEffectModalOpen,
    isEffectsModalOpen,
    openSelectEffect,
    openEffectsEditor,
    handleSelectEffect,
  };
}
