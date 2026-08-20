import type { CustomPreset } from '~/stores/presets.store';

/**
 * Returns a sorted copy of the custom presets filtered by category.
 */
export function getCustomPresetsByCategory(
  presets: CustomPreset[],
  category: CustomPreset['category'],
): CustomPreset[] {
  return presets
    .filter((preset) => preset.category === category)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((preset) => ({ ...preset }));
}
