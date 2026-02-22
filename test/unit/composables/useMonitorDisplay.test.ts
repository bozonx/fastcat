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

  it('calculates correct scale based on container size', () => {
    const projectStore = useProjectStore();
    projectStore.projectSettings.export.width = 1920;
    projectStore.projectSettings.export.height = 1080;

    const { canvasScale, canvasDisplaySize } = useMonitorDisplay();
    
    // Simulate a 960x540 container (exactly half size)
    canvasDisplaySize.value = { width: 960, height: 540 };
    expect(canvasScale.value).toBe(0.5);
    
    // Simulate a very wide container 3840x540 (scale should be limited by height)
    canvasDisplaySize.value = { width: 3840, height: 540 };
    expect(canvasScale.value).toBe(0.5);
  });

  it('generates correct wrapper styles', () => {
    const { getCanvasWrapperStyle, canvasDisplaySize } = useMonitorDisplay();
    
    canvasDisplaySize.value = { width: 800, height: 600 };
    
    const style = getCanvasWrapperStyle();
    expect(style).toEqual({
      width: '800px',
      height: '600px',
      overflow: 'hidden'
    });
  });

  it('generates correct inner styles', () => {
    const { getCanvasInnerStyle, canvasDisplaySize } = useMonitorDisplay();
    
    canvasDisplaySize.value = { width: 960, height: 540 };
    
    const style = getCanvasInnerStyle();
    expect(style.width).toBe('1920px');
    expect(style.height).toBe('1080px');
    expect(style.transform).toBe('scale(0.5)');
    expect(style.transformOrigin).toBe('top left');
  });

  it('updates canvas display size based on viewport', () => {
    const { updateCanvasDisplaySize, canvasDisplaySize, viewportEl } = useMonitorDisplay();
    
    // Create a mock DOM element
    const mockViewport = document.createElement('div');
    Object.defineProperty(mockViewport, 'clientWidth', { value: 1280, writable: true });
    Object.defineProperty(mockViewport, 'clientHeight', { value: 720, writable: true });
    
    viewportEl.value = mockViewport as unknown as HTMLDivElement;
    
    updateCanvasDisplaySize();
    
    // Should maintain 16:9 ratio
    expect(canvasDisplaySize.value.width).toBe(1280);
    expect(canvasDisplaySize.value.height).toBe(720);
    
    // Change viewport to be taller (constrained by width)
    Object.defineProperty(mockViewport, 'clientWidth', { value: 1280, writable: true });
    Object.defineProperty(mockViewport, 'clientHeight', { value: 1000, writable: true });
    
    updateCanvasDisplaySize();
    
    expect(canvasDisplaySize.value.width).toBe(1280);
    expect(canvasDisplaySize.value.height).toBe(720); // 1280 / (16/9)
    
    // Change viewport to be wider (constrained by height)
    Object.defineProperty(mockViewport, 'clientWidth', { value: 1600, writable: true });
    Object.defineProperty(mockViewport, 'clientHeight', { value: 720, writable: true });
    
    updateCanvasDisplaySize();
    
    expect(canvasDisplaySize.value.height).toBe(720);
    expect(canvasDisplaySize.value.width).toBe(1280); // 720 * (16/9)
  });
});
