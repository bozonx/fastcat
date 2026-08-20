import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

import MonitorOverlayContent from '~/components/monitor/MonitorOverlayContent.vue';

const getGridLines = vi.fn(() => [
  { x1: 0, y1: 360, x2: 1920, y2: 360 },
  { x1: 640, y1: 0, x2: 640, y2: 1080 },
]);

function mountComponent(props: Partial<InstanceType<typeof MonitorOverlayContent>['$props']> = {}) {
  return mount(MonitorOverlayContent, {
    props: {
      renderWidth: 1920,
      renderHeight: 1080,
      showGrid: false,
      getGridLines,
      isInteractiveEditEnabled: false,
      isReadonly: false,
      isTextClipSelected: false,
      isAdjustmentClipSelected: false,
      ...props,
    },
    global: {
      stubs: {
        MonitorInteractiveOverlay: {
          template: '<g class="interactive-overlay-stub" />',
        },
        MonitorTextTransformBox: {
          template: '<g class="text-transform-stub" />',
        },
        MonitorTransformBox: {
          template: '<g class="transform-stub" />',
        },
      },
    },
  });
}

describe('MonitorOverlayContent', () => {
  it('renders grid lines when showGrid is true', () => {
    const wrapper = mountComponent({ showGrid: true });
    expect(wrapper.findAll('line')).toHaveLength(2);
  });

  it('does not render grid lines when showGrid is false', () => {
    const wrapper = mountComponent({ showGrid: false });
    expect(wrapper.findAll('line')).toHaveLength(0);
  });

  it('renders interactive overlay when editing is enabled and not readonly', () => {
    const wrapper = mountComponent({ isInteractiveEditEnabled: true, isReadonly: false });
    expect(wrapper.find('.interactive-overlay-stub').exists()).toBe(true);
  });

  it('does not render interactive overlay when readonly', () => {
    const wrapper = mountComponent({ isInteractiveEditEnabled: true, isReadonly: true });
    expect(wrapper.find('.interactive-overlay-stub').exists()).toBe(false);
  });

  it('renders text transform box when a text clip is selected', () => {
    const wrapper = mountComponent({
      isInteractiveEditEnabled: true,
      isTextClipSelected: true,
    });
    expect(wrapper.find('.text-transform-stub').exists()).toBe(true);
    expect(wrapper.find('.transform-stub').exists()).toBe(false);
  });

  it('renders generic transform box when no text clip and no adjustment clip', () => {
    const wrapper = mountComponent({
      isInteractiveEditEnabled: true,
      isTextClipSelected: false,
      isAdjustmentClipSelected: false,
    });
    expect(wrapper.find('.text-transform-stub').exists()).toBe(false);
    expect(wrapper.find('.transform-stub').exists()).toBe(true);
  });

  it('does not render transform box when adjustment clip is selected', () => {
    const wrapper = mountComponent({
      isInteractiveEditEnabled: true,
      isTextClipSelected: false,
      isAdjustmentClipSelected: true,
    });
    expect(wrapper.find('.transform-stub').exists()).toBe(false);
    expect(wrapper.find('.text-transform-stub').exists()).toBe(false);
  });
});
