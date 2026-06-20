import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFileBrowserNavbar from '~/components/file-manager/MobileFileBrowserNavbar.vue';
import MobileFileBrowserCreateSheet from '~/components/file-manager/MobileFileBrowserCreateSheet.vue';
import MobileFileBrowserSelectionToolbar from '~/components/file-manager/MobileFileBrowserSelectionToolbar.vue';

const mockProxyStore = {
  existingProxies: new Set<string>(),
  generatingProxies: new Set<string>(),
};

const mockMediaStore = {
  mediaMetadata: {} as Record<string, { audio?: unknown }>,
  getCachedMetadata: vi.fn((path: string) => mockMediaStore.mediaMetadata[path]),
};

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => mockProxyStore,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mockMediaStore,
}));

describe('MobileFileBrowserNavbar', () => {
  const defaultProps = {
    isSelectionMode: false,
    selectedCount: 0,
    totalSelectedSize: 0,
    breadcrumbs: [{ name: 'foo', path: 'foo' }],
    hasFolderPath: true,
    menuItems: [[]],
  };

  it('renders breadcrumbs and back button', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserNavbar, {
      props: defaultProps,
      global: {
        stubs: {
          UButton: { template: '<button class="u-button-stub" v-bind="$attrs"><slot /></button>' },
          Icon: true,
          UDropdownMenu: true,
        },
      },
    });

    expect(wrapper.text()).toContain('foo');
    // Check by icon attribute if passed to the button stub
    expect(wrapper.find('button[icon="lucide:chevron-left"]').exists()).toBe(true);
  });

  it('shows selected count in selection mode', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, isSelectionMode: true, selectedCount: 5, totalSelectedSize: 1024 },
      global: {
        stubs: { UButton: true, Icon: true, UDropdownMenu: true },
      },
    });

    expect(wrapper.text()).toContain('5');
    expect(wrapper.text()).toContain('1 KB');
  });

  it('emits back event on click', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserNavbar, {
      props: defaultProps,
      global: {
        stubs: {
          UButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          Icon: true,
          UDropdownMenu: true,
        },
      },
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();
  });
});

describe('MobileFileBrowserCreateSheet', () => {
  const defaultProps = {
    modelValue: true,
    selectedFolderName: 'Music',
  };

  it('renders folder name in header', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserCreateSheet, {
      props: defaultProps,
      global: {
        stubs: { UiMobileDrawer: { template: '<div><slot /></div>' }, Icon: true },
      },
    });

    expect(wrapper.text()).toContain('Music');
  });

  it('emits events on action button clicks', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserCreateSheet, {
      props: defaultProps,
      global: {
        stubs: { UiMobileDrawer: { template: '<div><slot /></div>' }, Icon: true },
      },
    });

    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');
    expect(wrapper.emitted('upload')).toBeTruthy();
  });
});

describe('MobileFileBrowserSelectionToolbar', () => {
  const entries = [{ name: 'f1', kind: 'file', path: 'f1' }] as any[];

  beforeEach(() => {
    mockProxyStore.existingProxies.clear();
    mockProxyStore.generatingProxies.clear();
    mockMediaStore.mediaMetadata = {};
  });

  it('renders action buttons', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: { selectedEntries: entries, canAddToTimeline: true },
      global: {
        stubs: {
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: ['label'],
            template: '<button>{{ label }}</button>',
          },
          Icon: true,
        },
      },
    });

    expect(wrapper.text()).toContain('common.toTimeline');
  });

  it('renders proxy and extract audio actions for selected videos', async () => {
    const videoEntries = [{ name: 'clip.mp4', kind: 'file', path: 'clip.mp4' }] as any[];
    mockProxyStore.existingProxies.add('clip.mp4');
    mockMediaStore.mediaMetadata = {
      'clip.mp4': { audio: {} },
    };

    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: { selectedEntries: videoEntries, canAddToTimeline: false },
      global: {
        stubs: {
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: ['label'],
            template: '<button>{{ label }}</button>',
          },
          Icon: true,
        },
      },
    });

    expect(wrapper.text()).toContain('videoEditor.fileManager.actions.createProxy');
    expect(wrapper.text()).toContain('videoEditor.fileManager.actions.deleteProxy');
  });

  it('emits action event when buttons are clicked', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: { selectedEntries: entries, canAddToTimeline: false },
      global: {
        stubs: {
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          Icon: true,
        },
      },
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('action')).toBeTruthy();
    expect(wrapper.emitted('action')?.[0]).toEqual(['delete', entries]);
  });

  it('hides clipboard actions when requested', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: {
        selectedEntries: entries,
        canAddToTimeline: false,
        hideClipboardActions: true,
      },
      global: {
        stubs: {
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: ['icon'],
            template: '<button :data-icon="icon" />',
          },
        },
      },
    });

    expect(wrapper.find('[data-icon="i-heroicons-document-duplicate"]').exists()).toBe(false);
    expect(wrapper.find('[data-icon="i-heroicons-scissors"]').exists()).toBe(false);
    expect(wrapper.find('[data-icon="i-heroicons-trash"]').exists()).toBe(true);
  });
});
