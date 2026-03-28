import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ImageViewer from '~/components/preview/ImageViewer.vue';
import { useUiStore } from '~/stores/ui.store';

// Mock pan zoom composable
vi.mock('~/composables/preview/useImagePanZoom', () => ({
  useImagePanZoom: vi.fn(() => ({
    scale: { value: 1.0 },
    translateX: { value: 0 },
    translateY: { value: 0 },
    isReady: { value: true },
    reset: vi.fn(),
    fitToContainer: vi.fn(),
    onWheel: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onAuxClick: vi.fn(),
    onCustomZoom: vi.fn(),
  })),
}));

describe('ImageViewer.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders image with src', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: {
        src: 'http://example.com/test.jpg',
        alt: 'test alt',
      },
    });

    const img = component.find('img');
    expect(img.attributes('src')).toBe('http://example.com/test.jpg');
    expect(img.attributes('alt')).toBe('test alt');
  });

  it('emits open-modal on click in non-modal mode', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: {
        src: 'http://example.com/test.jpg',
        isModal: false,
      },
    });

    await component.find('.image-viewer-container').trigger('click');
    expect(component.emitted('open-modal')).toBeTruthy();
  });

  it('emits close-modal on click in modal mode', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: {
        src: 'http://example.com/test.jpg',
        isModal: true,
      },
    });

    await component.find('.image-viewer-container').trigger('click');
    expect(component.emitted('close-modal')).toBeTruthy();
  });

  it('handles zoom triggers from uiStore', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: {
        src: 'http://example.com/test.jpg',
        isModal: true,
      },
    });

    const { useImagePanZoom } = await import('~/composables/preview/useImagePanZoom');
    const { onCustomZoom, reset, fitToContainer } = (useImagePanZoom as any).mock.results[0].value;
    const uiStore = useUiStore();

    // Reset trigger
    uiStore.previewZoomResetTrigger = Date.now();
    await component.vm.$nextTick();
    expect(reset).toHaveBeenCalled();

    // Fit trigger
    uiStore.previewZoomFitTrigger = Date.now();
    await component.vm.$nextTick();
    expect(fitToContainer).toHaveBeenCalled();

    // Custom zoom trigger
    uiStore.previewZoomTrigger = { timestamp: Date.now(), dir: 'in' };
    await component.vm.$nextTick();
    expect(onCustomZoom).toHaveBeenCalled();
  });

  it('calls fitToContainer on image load', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: { src: 'http://example.com/test.jpg' },
    });

    const { useImagePanZoom } = await import('~/composables/preview/useImagePanZoom');
    const { fitToContainer } = (useImagePanZoom as any).mock.results[0].value;

    await component.find('img').trigger('load');
    expect(fitToContainer).toHaveBeenCalled();
  });

  it('calls fitToContainer on source change', async () => {
    const component = await mountWithNuxt(ImageViewer, {
      props: { src: 'http://example.com/test.jpg' },
    });

    const { useImagePanZoom } = await import('~/composables/preview/useImagePanZoom');
    const { fitToContainer } = (useImagePanZoom as any).mock.results[0].value;

    await component.setProps({ src: 'http://example.com/new.jpg' });
    expect(fitToContainer).toHaveBeenCalled();
  });
});
