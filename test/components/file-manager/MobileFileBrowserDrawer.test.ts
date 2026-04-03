import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import MobileFileBrowserDrawer from '~/components/file-manager/MobileFileBrowserDrawer.vue';

// --- Mocks ---

const mockSelectionStore = reactive({
  selectedEntity: null as any,
});

vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual('@vueuse/core');
  return {
    ...(actual as any),
    useWindowSize: () => ({ width: ref(1000), height: ref(500) }), // Landscape by default
  };
});

// Stub sub-components to avoid complex i18n/store dependencies
vi.mock('~/components/properties/FileProperties.vue', () => ({
  default: { template: '<div id="file-properties" />' },
}));
vi.mock('~/components/properties/MultiFileProperties.vue', () => ({
  default: { template: '<div id="multi-file-properties" />' },
}));
vi.mock('~/components/timeline/MobileDrawerToolbarButton.vue', () => ({
  default: {
    template: '<button :data-icon="icon" :data-label="label" @click="$emit(\'click\')"><slot /></button>',
    props: ['icon', 'label']
  }
}));
vi.mock('~/components/properties/PropertyActionList.vue', () => ({
  default: {
    template: '<div id="property-action-list" :data-count="actions.length"><slot /></div>',
    props: ['actions']
  }
}));
vi.mock('~/stores/file-conversion.store', () => ({
  useFileConversionStore: () => ({
    openConversionModal: vi.fn(),
  })
}));

describe('MobileFileBrowserDrawer', () => {
  const defaultProps = {
    isOpen: true,
    isSelectionMode: false,
    onAction: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
  });

  it('renders FileProperties for single file selection', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.mp4',
      name: 'test.mp4',
      entry: { kind: 'file', path: 'test.mp4', name: 'test.mp4' },
    };

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: defaultProps,
      global: {
        stubs: {
          UDrawer: { template: '<div><slot name="content" /></div>' },
          UButton: true,
          Icon: true,
        },
      },
    });

    expect(wrapper.find('#file-properties').exists()).toBe(true);
  });

  it('renders MultiFileProperties for multiple selection', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'multiple',
      entries: [
        { kind: 'file', path: '1.mp4' },
        { kind: 'file', path: '2.mp4' },
      ],
    };

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: defaultProps,
      global: {
        stubs: {
          UDrawer: { template: '<div><slot name="content" /></div>' },
          UButton: true,
          Icon: true,
        },
      },
    });

    expect(wrapper.find('#multi-file-properties').exists()).toBe(true);
  });

  it('emits action event when buttons are clicked', async () => {
    const onAction = vi.fn();
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.mp4',
      name: 'test.mp4',
      entry: { kind: 'file', path: 'test.mp4', name: 'test.mp4' },
    };

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: { ...defaultProps, onAction },
      global: {
        stubs: {
          UDrawer: { template: '<div><slot name="content" /></div>' },
          UButton: {
            template: '<button :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
            props: ['icon'],
          },
          Icon: true,
        },
      },
    });

    const deleteButton = wrapper.find('button[data-icon="i-heroicons-trash"]');
    await deleteButton.trigger('click');

    expect(onAction).toHaveBeenCalledWith('delete', expect.anything());
  });

  it('renders top actions for video files', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.mp4',
      name: 'test.mp4',
      entry: { kind: 'file', path: 'test.mp4', name: 'test.mp4' },
    };

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: defaultProps,
      global: {
        stubs: {
          UDrawer: { template: '<div><slot name="content" /></div>' },
          UButton: true,
          Icon: true,
        },
      },
    });

    const actionList = wrapper.find('#property-action-list');
    expect(actionList.exists()).toBe(true);
    // Actions: Add to timeline, Convert, Transcribe, Proxy, Extract Audio
    expect(actionList.attributes('data-count')).toBe('5');
  });

  it('renders top actions for image files', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.jpg',
      name: 'test.jpg',
      entry: { kind: 'file', path: 'test.jpg', name: 'test.jpg' },
    };

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: defaultProps,
      global: {
        stubs: {
          UDrawer: { template: '<div><slot name="content" /></div>' },
          UButton: true,
          Icon: true,
        },
      },
    });

    const actionList = wrapper.find('#property-action-list');
    expect(actionList.exists()).toBe(true);
    // Actions: Add to timeline, Convert
    expect(actionList.attributes('data-count')).toBe('2');
  });
});
