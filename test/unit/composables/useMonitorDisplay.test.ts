import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useProjectStore } from '~/stores/project.store';

describe('useMonitorDisplay', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('provides sensible defaults for export dimensions', () => {
    const { exportWidth, exportHeight, aspectRatio } = useMonitorDisplay();
    expect(exportWidth.value).toBe(1920);
    expect(exportHeight.value).toBe(1080);
    expect(aspectRatio.value).toBe(1920 / 1080);
  });

  it('respects valid project settings', () => {
    const projectStore = useProjectStore();
    projectStore.projectSettings.export.width = 1280;
    projectStore.projectSettings.export.height = 720;

    const { exportWidth, exportHeight, aspectRatio } = useMonitorDisplay();
    expect(exportWidth.value).toBe(1280);
    expect(exportHeight.value).toBe(720);
    expect(aspectRatio.value).toBe(1280 / 720);
  });

  it('clamps dimensions to MIN/MAX limits', () => {
    const projectStore = useProjectStore();

    // Test minimum limits
    projectStore.projectSettings.export.width = 5;
    projectStore.projectSettings.export.height = -10;

    const { exportWidth, exportHeight } = useMonitorDisplay();
    expect(exportWidth.value).toBe(16); // MIN_CANVAS_DIMENSION
    expect(exportHeight.value).toBe(1080); // defaults to 1080 if <= 0

    // Test maximum limits
    projectStore.projectSettings.export.width = 10000;
    projectStore.projectSettings.export.height = 8000;

    expect(exportWidth.value).toBe(7680); // MAX_CANVAS_DIMENSION
    expect(exportHeight.value).toBe(7680); // MAX_CANVAS_DIMENSION
  });

  it('generates correct wrapper styles', () => {
    const projectStore = useProjectStore();
    projectStore.projectSettings.export.width = 1920;
    projectStore.projectSettings.export.height = 1080;
    projectStore.projectSettings.monitor.previewResolution = 480;

    const { getCanvasWrapperStyle, renderWidth, renderHeight } = useMonitorDisplay();

    const style = getCanvasWrapperStyle();
    expect(style).toEqual({
      width: `${renderWidth.value}px`,
      height: `${renderHeight.value}px`,
      overflow: 'hidden',
    });
  });

  it('generates correct inner styles', () => {
    const projectStore = useProjectStore();
    projectStore.projectSettings.export.width = 1920;
    projectStore.projectSettings.export.height = 1080;
    projectStore.projectSettings.monitor.previewResolution = 480;

    const { getCanvasInnerStyle, renderWidth, renderHeight } = useMonitorDisplay();

    // Get the current render dimensions from computed refs
    const currentRenderWidth = renderWidth.value;
    const currentRenderHeight = renderHeight.value;

    // No-op edit just to satisfy the tool call that I startednder dimensions
    const style = getCanvasInnerStyle();
    expect(style.width).toBe(`${currentRenderWidth}px`);
    expect(style.height).toBe(`${currentRenderHeight}px`);
  });

  it('updateCanvasDisplaySize is a no-op for fixed preview resolution sizing', () => {
    const projectStore = useProjectStore();
    projectStore.projectSettings.export.width = 1920;
    projectStore.projectSettings.export.height = 1080;
    projectStore.projectSettings.monitor.previewResolution = 480;

    const { updateCanvasDisplaySize, viewportEl, renderWidth, renderHeight } = useMonitorDisplay();

    const mockViewport = document.createElement('div');
    Object.defineProperty(mockViewport, 'clientWidth', { value: 1, writable: true });
    Object.defineProperty(mockViewport, 'clientHeight', { value: 1, writable: true });
    viewportEl.value = mockViewport as unknown as HTMLDivElement;

    updateCanvasDisplaySize();

    expect(renderHeight.value).toBe(480);
    expect(renderWidth.value).toBe(Math.round(480 * (1920 / 1080)));
  });
});
