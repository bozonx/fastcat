import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import MobileFileBrowserPasteToolbar from '~/components/file-manager/MobileFileBrowserPasteToolbar.vue';

// --- Mocks ---

const mockClipboardStore = reactive({
  clipboardPayload: null as any,
});

vi.mock('~/stores/clipboard.store', () => ({ useClipboardStore: () => mockClipboardStore }));

describe('MobileFileBrowserPasteToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with copy operation', async () => {
    mockClipboardStore.clipboardPayload = {
      operation: 'copy',
      items: [{}, {}],
    };

    const wrapper = await mountSuspended(MobileFileBrowserPasteToolbar, {
      global: {
        stubs: { UButton: true },
      },
    });

    expect(wrapper.text()).toContain('common.copied');
    expect(wrapper.text()).toContain('2');
  });

  it('renders correctly with cut operation', async () => {
    mockClipboardStore.clipboardPayload = {
      operation: 'cut',
      items: [{}, {}, {}],
    };

    const wrapper = await mountSuspended(MobileFileBrowserPasteToolbar, {
      global: {
        stubs: { UButton: true },
      },
    });

    expect(wrapper.text()).toContain('common.cut');
    expect(wrapper.text()).toContain('3');
  });

  it('emits paste event', async () => {
    mockClipboardStore.clipboardPayload = {
      operation: 'copy',
      items: [{}, {}],
    };

    const wrapper = await mountSuspended(MobileFileBrowserPasteToolbar, {
      global: {
        stubs: {
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');

    expect(wrapper.emitted('paste')).toBeTruthy();
  });
});
