import { describe, it, expect, vi } from 'vitest';
import { useMonitorGrid } from '~/composables/monitor/useMonitorGrid';
import { ref } from 'vue';

describe('useMonitorGrid', () => {
  it('correctly manages grid toggle state', () => {
    const activeMonitor = ref({ showGrid: false });
    const mockProjectStore = {
      activeMonitor: activeMonitor.value,
    } as any;

    const { showGrid, toggleGrid } = useMonitorGrid({ projectStore: mockProjectStore });

    expect(showGrid.value).toBe(false);

    toggleGrid();
    expect(showGrid.value).toBe(true);

    toggleGrid();
    expect(showGrid.value).toBe(false);
  });

  it('generates rule-of-thirds grid line coordinates for given width and height', () => {
    const mockProjectStore = { activeMonitor: { showGrid: true } } as any;
    const { getGridLines } = useMonitorGrid({ projectStore: mockProjectStore });

    const lines = getGridLines(1920, 1080);
    // 2 vertical lines + 2 horizontal lines = 4 lines
    expect(lines.length).toBe(4);

    // Vertical lines at x = 640 and x = 1280
    expect(lines[0]).toEqual({ x1: 640, y1: 0, x2: 640, y2: 1080 });
    expect(lines[1]).toEqual({ x1: 1280, y1: 0, x2: 1280, y2: 1080 });

    // Horizontal lines at y = 360 and y = 720
    expect(lines[2]).toEqual({ x1: 0, y1: 360, x2: 1920, y2: 360 });
    expect(lines[3]).toEqual({ x1: 0, y1: 720, x2: 1920, y2: 720 });
  });
});
