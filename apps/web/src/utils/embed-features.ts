import { computed, ref, type ComputedRef } from 'vue';
import { isEmbedRuntime } from '~/utils/embed-runtime';

/**
 * Optional capabilities a host can switch on for an embedded session.
 *
 * The embed is one screen, not an application: by default it offers the
 * timeline and an export, and nothing else. Anything a host actually wants —
 * a media bin, the audio view, the settings panel — it asks for explicitly at
 * handshake time. Flags arrive per session rather than being baked into the
 * build so one deployed artifact can serve every integration.
 */
export const EMBED_FEATURES = ['files', 'sound', 'export', 'settings'] as const;

export type EmbedFeature = (typeof EMBED_FEATURES)[number];

const DEFAULT_EMBED_FEATURES: readonly EmbedFeature[] = ['export'];

const enabledFeatures = ref<Set<EmbedFeature>>(new Set(DEFAULT_EMBED_FEATURES));

function isEmbedFeature(value: unknown): value is EmbedFeature {
  return typeof value === 'string' && (EMBED_FEATURES as readonly string[]).includes(value);
}

/**
 * Applies the host's feature list. Unknown entries are dropped rather than
 * rejected so a newer host can talk to an older editor without failing the
 * handshake over a flag the editor has never heard of.
 */
export function setEmbedFeatures(features: readonly unknown[] | undefined): void {
  if (!features) {
    enabledFeatures.value = new Set(DEFAULT_EMBED_FEATURES);
    return;
  }
  enabledFeatures.value = new Set(features.filter(isEmbedFeature));
}

export function isEmbedFeatureEnabled(feature: EmbedFeature): boolean {
  return enabledFeatures.value.has(feature);
}

/**
 * Whether a view the host can switch off is there to use: always outside an
 * embed, and inside one only when the host asked for it. Anything that leads to
 * such a view — a shortcut, a "show in" action — should check this first.
 */
export function isFeatureAvailable(feature: EmbedFeature): boolean {
  return !isEmbedRuntime() || isEmbedFeatureEnabled(feature);
}

export function useEmbedFeatures(): {
  features: ComputedRef<ReadonlySet<EmbedFeature>>;
  isEnabled: (feature: EmbedFeature) => boolean;
} {
  return {
    features: computed(() => enabledFeatures.value),
    isEnabled: (feature) => enabledFeatures.value.has(feature),
  };
}
