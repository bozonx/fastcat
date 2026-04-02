import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFileBrowserNavbar from '~/components/file-manager/MobileFileBrowserNavbar.vue';
import MobileFileBrowserCreateSheet from '~/components/file-manager/MobileFileBrowserCreateSheet.vue';
import MobileFileBrowserSelectionToolbar from '~/components/file-manager/MobileFileBrowserSelectionToolbar.vue';

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
    selectedFolderPath: 'music',
  };

  it('renders folder name in header', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserCreateSheet, {
      props: defaultProps,
      global: {
        stubs: { UDrawer: { template: '<div><slot name="content" /></div>' }, Icon: true },
      },
    });

    expect(wrapper.text()).toContain('Music');
  });

  it('emits events on action button clicks', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserCreateSheet, {
      props: defaultProps,
      global: {
        stubs: { UDrawer: { template: '<div><slot name="content" /></div>' }, Icon: true },
      },
    });

    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click'); // First button is usually upload
    expect(wrapper.emitted('upload')).toBeTruthy();
  });
});

describe('MobileFileBrowserSelectionToolbar', () => {
  const entries = [{ name: 'f1', kind: 'file', path: 'f1' }] as any[];

  it('renders action buttons', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: { selectedEntries: entries, canAddToTimeline: true },
      global: {
        stubs: { UButton: { template: '<button><slot /></button>' }, Icon: true },
      },
    });

    expect(wrapper.text()).toContain('common.delete');
    expect(wrapper.text()).toContain('common.copy');
    expect(wrapper.text()).toContain('common.addToTimeline');
  });

  it('emits action event when buttons are clicked', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserSelectionToolbar, {
      props: { selectedEntries: entries, canAddToTimeline: false },
      global: {
        stubs: {
          UButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          Icon: true,
        },
      },
    });

    await wrapper.find('button').trigger('click'); // First button is delete
    expect(wrapper.emitted('action')).toBeTruthy();
    expect(wrapper.emitted('action')?.[0]).toEqual(['delete', entries]);
  });
});
