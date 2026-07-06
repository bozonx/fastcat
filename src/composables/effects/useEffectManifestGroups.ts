import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import {
  getAllAudioEffectManifests,
  getAllVideoEffectManifests,
  getEffectManifest,
  type EffectManifest,
} from '~/effects';
import { usePresetsStore } from '~/stores/presets.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

export interface EffectManifestGroups {
  basic: EffectManifest[];
  custom: EffectManifest[];
  hasAnyEffects: boolean;
  nonBasic: EffectManifest[];
  standard: EffectManifest[];
}

export function useEffectManifestGroups(
  target: MaybeRefOrGetter<'video' | 'audio'>,
  audioRegistryVersion?: MaybeRefOrGetter<unknown>,
) {
  const presetsStore = usePresetsStore();
  const workspaceStore = useWorkspaceStore();

  const allManifests = computed(() => {
    const resolvedTarget = toValue(target);
    if (resolvedTarget === 'audio') {
      void toValue(audioRegistryVersion);
    }

    const manifests =
      resolvedTarget === 'video' ? getAllVideoEffectManifests() : getAllAudioEffectManifests();

    return manifests.filter((manifest) => {
      return !manifest.experimental || workspaceStore.inDevelopmentFeaturesEnabled;
    });
  });

  const groups = computed<EffectManifestGroups>(() => {
    const resolvedTarget = toValue(target);
    const standard = allManifests.value.filter((manifest) => !manifest.isCustom);
    const basic = standard.filter((manifest) => (manifest.category ?? 'basic') === 'basic');
    const nonBasic = standard.filter((manifest) => (manifest.category ?? 'basic') !== 'basic');
    const custom = presetsStore.customPresets
      .filter(
        (preset) =>
          preset.category === 'effect' && (preset.effectTarget ?? 'video') === resolvedTarget,
      )
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((preset) => {
        const manifest = getEffectManifest(preset.id);
        if (!manifest) return null;
        return { ...manifest, name: preset.name };
      })
      .filter((manifest): manifest is EffectManifest => Boolean(manifest));

    return {
      basic,
      custom,
      nonBasic,
      standard,
      hasAnyEffects: standard.length > 0 || custom.length > 0,
    };
  });

  return {
    allManifests,
    groups,
  };
}
