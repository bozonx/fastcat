import { computed } from 'vue';
import type { useProjectStore } from '~/stores/project.store';

/**
 * Composable for the monitor 3x3 guide grid overlay.
 * Grid lines are positioned relative to canvas dimensions and synchronized
 * with the viewport transform via the SVG overlay slot.
 */
export function useMonitorGrid(input: { projectStore: ReturnType<typeof useProjectStore> }) {
  const showGrid = computed({
    get: () => input.projectStore.projectSettings.monitor?.showGrid ?? false,
    set: (v: boolean) => {
      if (!input.projectStore.projectSettings.monitor) return;
      input.projectStore.projectSettings.monitor.showGrid = v;
    },
  });

  function toggleGrid() {
    showGrid.value = !showGrid.value;
  }

  /**
   * Returns SVG line definitions for a 3x3 rule-of-thirds grid
   * covering the canvas at (0,0) with given width/height.
   */
  function getGridLines(width: number, height: number) {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    // 2 vertical lines at 1/3 and 2/3
    for (let i = 1; i <= 2; i++) {
      const x = Math.round((width * i) / 3);
      lines.push({ x1: x, y1: 0, x2: x, y2: height });
    }
    // 2 horizontal lines at 1/3 and 2/3
    for (let i = 1; i <= 2; i++) {
      const y = Math.round((height * i) / 3);
      lines.push({ x1: 0, y1: y, x2: width, y2: y });
    }
    return lines;
  }

  return { showGrid, toggleGrid, getGridLines };
}
