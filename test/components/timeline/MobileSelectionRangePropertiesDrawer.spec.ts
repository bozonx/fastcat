import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileSelectionRangePropertiesDrawer from '~/components/timeline/MobileSelectionRangePropertiesDrawer.vue';

const removeSelectionRangeMock = vi.fn();
const clearSelectionMock = vi.fn();

const mockTimelineStore = reactive({
  getSelectionRange: vi.fn(() => ({ start: 0, end: 1000 })),
  removeSelectionRange: removeSelectionRangeMock,
});

const mockSelectionStore = reactive({
  selectedEntity: { source: 'timeline', kind: 'selection-range' },
  clearSelection: clearSelectionMock,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

const globalOptions = {
  stubs: {
    MobilePropertiesDrawer: {
      props: ['isOpen', 'activeSnapPoint'],
      emits: ['close', 'update:activeSnapPoint'],
      template: '<div class="drawer"><slot name="toolbar" /><slot /></div>',
    },
    MobileDrawerToolbarButton: {
      props: ['icon'],
      emits: ['click'],
      template: '<button class="toolbar-button" :data-icon="icon" @click="$emit(\'click\')" />',
    },
    SelectionRangeProperties: {
      props: ['isMobile'],
      template: '<div class="selection-range-properties">Properties</div>',
    },
  },
};

describe('MobileSelectionRangePropertiesDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drawer and properties', async () => {
    const wrapper = await mountSuspended(MobileSelectionRangePropertiesDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.selection-range-properties').exists()).toBe(true);
  });

  it('renders the delete toolbar button', async () => {
    const wrapper = await mountSuspended(MobileSelectionRangePropertiesDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const deleteButton = wrapper.find('[data-icon="i-heroicons-trash"]');
    expect(deleteButton.exists()).toBe(true);
  });

  it('removes the selection range and closes the drawer on delete', async () => {
    const wrapper = await mountSuspended(MobileSelectionRangePropertiesDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    await wrapper.find('[data-icon="i-heroicons-trash"]').trigger('click');
    expect(removeSelectionRangeMock).toHaveBeenCalledOnce();
    expect(clearSelectionMock).toHaveBeenCalledOnce();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
