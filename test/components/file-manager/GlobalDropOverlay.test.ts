import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GlobalDropOverlay from '~/components/file-manager/GlobalDropOverlay.vue';

describe('GlobalDropOverlay', () => {
  const rootEntries = [
    { name: 'Videos', kind: 'directory', path: '_video', children: [] },
    { name: 'Common', kind: 'directory', path: '::workspace-common::', children: [] },
  ];

  it('renders both drop zones', () => {
    const wrapper = mount(GlobalDropOverlay, {
      props: {
        rootEntries: rootEntries as any,
      },
      global: {
        stubs: {
          UIcon: true,
          GlobalDropOverlayTree: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Auto-sort upload');
    expect(wrapper.text()).toContain('Upload to folder');
  });

  it('detects drag over auto-sort zone', async () => {
    const wrapper = mount(GlobalDropOverlay, {
      props: {
        rootEntries: rootEntries as any,
      },
      global: {
        stubs: {
          UIcon: true,
          GlobalDropOverlayTree: true,
        },
      },
    });

    const autoZone = wrapper.find('.flex-1.flex.flex-col.items-center.justify-center');

    // Mock event with Files type
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        dropEffect: '',
      },
    } as any;

    await autoZone.trigger('dragover', event);
    expect(wrapper.vm.isDropOverAuto).toBe(true);
  });
});
