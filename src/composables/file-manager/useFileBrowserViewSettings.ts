import { computed } from 'vue';

export const FILE_BROWSER_GRID_SIZES = [80, 100, 130, 160, 200];

const FILE_BROWSER_GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'] as const;

interface FileBrowserViewSettingsParams {
  gridCardSize: () => number;
}

export function useFileBrowserViewSettings(params: FileBrowserViewSettingsParams) {
  const effectiveGridCardSize = computed(() => params.gridCardSize());

  const currentGridSizeName = computed(() => {
    const index = FILE_BROWSER_GRID_SIZES.indexOf(effectiveGridCardSize.value);
    return FILE_BROWSER_GRID_SIZE_NAMES[index] || 'm';
  });

  return {
    gridSizes: FILE_BROWSER_GRID_SIZES,
    effectiveGridCardSize,
    currentGridSizeName,
  };
}
