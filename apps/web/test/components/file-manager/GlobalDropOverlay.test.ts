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

    expect(wrapper.text()).toContain('videoEditor.fileManager.dropOverlay.autoTitle');
    expect(wrapper.text()).toContain('videoEditor.fileManager.dropOverlay.folderTitle');
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

    const autoZone = wrapper.find('.global-drop-overlay-auto-zone');

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

  it('emulates hover on auto-sort zone via Tauri custom event', async () => {
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

    const autoZone = wrapper.find('.global-drop-overlay-auto-zone').element;
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(autoZone);

    window.dispatchEvent(
      new CustomEvent('fastcat:tauri-drag-over', {
        detail: { clientX: 100, clientY: 100 },
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isDropOverAuto).toBe(true);
    expect(wrapper.vm.dropOverFolderPath).toBeNull();
    spy.mockRestore();
  });

  it('emulates hover on folder via Tauri custom event', async () => {
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

    const fakeFolder = document.createElement('div');
    fakeFolder.setAttribute('data-folder-path', '_video');
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(fakeFolder);

    window.dispatchEvent(
      new CustomEvent('fastcat:tauri-drag-over', {
        detail: { clientX: 300, clientY: 200 },
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isDropOverAuto).toBe(false);
    expect(wrapper.vm.dropOverFolderPath).toBe('_video');
    spy.mockRestore();
  });

  it('clears hover on Tauri drag leave', async () => {
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

    // Set hover state via custom event
    const autoZone = wrapper.find('.global-drop-overlay-auto-zone').element;
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(autoZone);

    window.dispatchEvent(
      new CustomEvent('fastcat:tauri-drag-over', {
        detail: { clientX: 100, clientY: 100 },
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.isDropOverAuto).toBe(true);

    spy.mockRestore();

    window.dispatchEvent(new CustomEvent('fastcat:tauri-drag-leave'));
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isDropOverAuto).toBe(false);
    expect(wrapper.vm.dropOverFolderPath).toBeNull();
  });

  it('handles dragover on backdrop', async () => {
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

    const event = {
      dataTransfer: {
        types: ['Files'],
        dropEffect: '',
      },
    } as any;

    await wrapper.trigger('dragover', event);
    expect(event.dataTransfer.dropEffect).toBe('none');
  });

  it('emits drop-outside on backdrop drop', async () => {
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

    const event = {
      dataTransfer: {
        types: ['Files'],
      },
    } as any;

    await wrapper.trigger('drop', event);
    expect(wrapper.emitted('drop-outside')).toBeTruthy();
  });
});
