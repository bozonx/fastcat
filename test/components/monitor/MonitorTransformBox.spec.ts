import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MonitorTransformBox from '~/components/monitor/MonitorTransformBox.vue';
import { ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';

// Mock useMonitorTimeline
vi.mock('~/composables/monitor/useMonitorTimeline', () => ({
  useMonitorTimeline: () => ({
    rawWorkerTimelineClips: ref([
      {
        id: 'clip-1',
        clipType: 'media',
        source: { path: 'test.mp4' },
        transform: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1, linked: true },
          rotationDeg: 0,
          anchor: { preset: 'center', x: 0.5, y: 0.5 },
        },
      },
    ]),
  }),
}));

describe('MonitorTransformBox', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        selection: {
          selectedEntity: { kind: 'clip', itemId: 'clip-1', trackId: 'track-1' },
        },
        media: {
          mediaMetadata: {
            'test.mp4': { video: { width: 1920, height: 1080 } },
          },
        },
      },
    });
  });

  it('renders transform box for selected clip', () => {
    const wrapper = mount(MonitorTransformBox, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      global: {
        plugins: [pinia],
      },
    });

    const rect = wrapper.find('rect');
    expect(rect.exists()).toBe(true);
    expect(rect.attributes('cursor')).toBe('move');
  });

  it('toggles between scale and rotate modes on click without move', async () => {
    const wrapper = mount(MonitorTransformBox, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      global: {
        plugins: [pinia],
      },
    });

    const rect = wrapper.get('rect');
    
    // Initial mode is scale (handles visible)
    expect(wrapper.findAll('circle').length).toBeGreaterThan(0);

    // Simulate click (down + up without move)
    await rect.trigger('pointerdown', { button: 0, clientX: 100, clientY: 100 });
    await window.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    
    // Mode should toggle to rotate
    await wrapper.vm.$nextTick(); // wait for mode update
    expect(rect.attributes('cursor')).toBe('ew-resize');
  });

  it('calls updateClipProperties when dragging', async () => {
    const wrapper = mount(MonitorTransformBox, {
      props: {
        renderWidth: 1920,
        renderHeight: 1080,
      },
      global: {
        plugins: [pinia],
      },
    });

    const timelineStore = useTimelineStore();
    const rect = wrapper.get('rect');

    // Start drag
    await rect.trigger('pointerdown', { button: 0, clientX: 100, clientY: 100 });
    
    // Move
    await window.dispatchEvent(new PointerEvent('pointermove', { clientX: 110, clientY: 110 }));
    
    // End drag
    await window.dispatchEvent(new PointerEvent('pointerup', { clientX: 110, clientY: 110 }));
    
    // Check if updateClipProperties was called (through updateTransform)
    // Note: pendingTransform is flushed on endDrag
    expect(timelineStore.updateClipProperties).toHaveBeenCalledWith(
      'track-1',
      'clip-1',
      expect.objectContaining({
        transform: expect.objectContaining({
          position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        }),
      }),
    );
  });
});
