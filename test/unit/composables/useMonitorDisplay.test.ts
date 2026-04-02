/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMonitorDisplay } from '~/composables/monitor/useMonitorDisplay';
import { useProjectStore } from '~/stores/project.store';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createTestingPinia } from '@pinia/testing';

describe('useMonitorDisplay', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
    });
  });

  function withMonitorDisplay(
    fn: (res: ReturnType<typeof useMonitorDisplay>, projectStore: any) => void,
  ) {
    const TestComp = defineComponent({
      setup() {
        const projectStore = useProjectStore();
        const res = useMonitorDisplay();
        fn(res, projectStore);
        return () => h('div');
      },
    });
    mount(TestComp, { global: { plugins: [pinia] } });
  }

  it('provides sensible defaults for export dimensions', () => {
    withMonitorDisplay((res) => {
      const { exportWidth, exportHeight, aspectRatio } = res;
      expect(exportWidth.value).toBe(1920);
      expect(exportHeight.value).toBe(1080);
      expect(aspectRatio.value).toBe(1920 / 1080);
    }, null);
  });

  it('respects valid project settings', () => {
    withMonitorDisplay((res, projectStore) => {
      projectStore.projectSettings.project.width = 1280;
      projectStore.projectSettings.project.height = 720;

      const { exportWidth, exportHeight, aspectRatio } = res;
      expect(exportWidth.value).toBe(1280);
      expect(exportHeight.value).toBe(720);
      expect(aspectRatio.value).toBe(1280 / 720);
    }, null);
  });

  it('clamps dimensions to MIN/MAX limits', () => {
    withMonitorDisplay((res, projectStore) => {
      // Test minimum limits
      projectStore.projectSettings.project.width = 5;
      projectStore.projectSettings.project.height = -10;

      const { exportWidth, exportHeight } = res;
      expect(exportWidth.value).toBe(16); // MIN_CANVAS_DIMENSION
      expect(exportHeight.value).toBe(1080); // defaults to 1080 if <= 0

      // Test maximum limits
      projectStore.projectSettings.project.width = 10000;
      projectStore.projectSettings.project.height = 8000;

      expect(exportWidth.value).toBe(7680); // MAX_CANVAS_DIMENSION
      expect(exportHeight.value).toBe(7680); // MAX_CANVAS_DIMENSION
    }, null);
  });

  it('generates correct wrapper styles', () => {
    withMonitorDisplay((res, projectStore) => {
      projectStore.projectSettings.project.width = 1920;
      projectStore.projectSettings.project.height = 1080;
      projectStore.projectSettings.monitors.cut.previewResolution = 480;

      const { getCanvasWrapperStyle, renderWidth, renderHeight } = res;

      const style = getCanvasWrapperStyle();
      expect(style).toEqual({
        width: `${renderWidth.value}px`,
        height: `${renderHeight.value}px`,
        overflow: 'hidden',
      });
    }, null);
  });

  it('generates correct inner styles', () => {
    withMonitorDisplay((res, projectStore) => {
      projectStore.projectSettings.project.width = 1920;
      projectStore.projectSettings.project.height = 1080;
      projectStore.projectSettings.monitors.cut.previewResolution = 480;

      const { getCanvasInnerStyle, renderWidth, renderHeight } = res;

      const style = getCanvasInnerStyle();
      expect(style.width).toBe(`${renderWidth.value}px`);
      expect(style.height).toBe(`${renderHeight.value}px`);
    }, null);
  });

  it('updateCanvasDisplaySize is a no-op for fixed preview resolution sizing', () => {
    withMonitorDisplay((res, projectStore) => {
      projectStore.projectSettings.project.width = 1920;
      projectStore.projectSettings.project.height = 1080;
      projectStore.projectSettings.monitors.cut.previewResolution = 480;

      const { updateCanvasDisplaySize, viewportEl, renderWidth, renderHeight } = res;

      const mockViewport = document.createElement('div');
      Object.defineProperty(mockViewport, 'clientWidth', { value: 1, writable: true });
      Object.defineProperty(mockViewport, 'clientHeight', { value: 1, writable: true });
      viewportEl.value = mockViewport as unknown as HTMLDivElement;

      updateCanvasDisplaySize();

      expect(renderHeight.value).toBe(480);
      expect(renderWidth.value).toBe(Math.round(480 * (1920 / 1080)));
    }, null);
  });
});
