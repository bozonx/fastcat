/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, reactive } from 'vue';
import { useImagePanZoom } from '~/composables/preview/useImagePanZoom';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('useImagePanZoom', () => {
  beforeEach(() => {
    mockWorkspaceStore.userSettings = reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)));
  });

  function createContainer() {
    const container = document.createElement('div');
    const image = document.createElement('img');

    Object.defineProperties(container, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    Object.defineProperties(image, {
      naturalWidth: { value: 400 },
      naturalHeight: { value: 300 },
    });

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    container.appendChild(image);

    return container;
  }

  it('uses the dominant wheel delta for image zoom', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheelSecondary = 'zoom';
    const containerRef = ref<HTMLElement | null>(createContainer());
    const panZoom = useImagePanZoom(containerRef);

    panZoom.fitToContainer();
    const initialScale = panZoom.scale.value;

    panZoom.onWheel({
      deltaX: -100,
      deltaY: 1,
      clientX: 400,
      clientY: 300,
      preventDefault: vi.fn(),
      ctrlKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);

    expect(panZoom.scale.value).toBeGreaterThan(initialScale);
  });

  it('uses middle double click action for shared viewer fit', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleDoubleClick = 'fit';
    const containerRef = ref<HTMLElement | null>(createContainer());
    const panZoom = useImagePanZoom(containerRef);

    panZoom.fitToContainer();
    panZoom.onWheel({
      deltaX: 0,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
      preventDefault: vi.fn(),
      ctrlKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);
    expect(panZoom.scale.value).toBeGreaterThan(1);

    panZoom.onAuxClick({
      button: 1,
      detail: 2,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(panZoom.scale.value).toBe(1);
    expect(panZoom.translateX.value).toBe(0);
    expect(panZoom.translateY.value).toBe(0);
  });
});
