import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import MobileFileBrowserNavbar from '~/components/file-manager/MobileFileBrowserNavbar.vue';

vi.mock('~/utils/format', () => ({
  formatBytes: (bytes: number) => `${bytes} B`,
}));

vi.mock('~/composables/useDropdownMenuBlur', () => ({
  blurOnDropdownMenuClose: vi.fn(),
}));

const mockProjectStore = reactive({});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('MobileFileBrowserNavbar', () => {
  const defaultProps = {
    isSelectionMode: false,
    selectedCount: 0,
    totalSelectedSize: 0,
    breadcrumbs: [{ name: 'Root', path: '/' }],
    hasFolderPath: false,
    menuItems: [],
  };

  it('renders navbar', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: defaultProps,
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.mobile-file-browser-navbar').exists()).toBe(true);
  });

  it('shows back button when hasFolderPath is true and not in selection mode', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, hasFolderPath: true },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('emits back when back button is clicked', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, hasFolderPath: true },
    });

    const backButton = component.find('button');
    await backButton.trigger('click');

    expect(component.emitted('back')).toBeTruthy();
  });

  it('shows cancel-selection button in selection mode', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, isSelectionMode: true, selectedCount: 3 },
    });

    expect(component.text()).toContain('3');
    expect(component.text()).toContain('common.selected');
  });

  it('emits cancel-selection when cancel button is clicked', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, isSelectionMode: true, selectedCount: 1 },
    });

    const cancelButton = component.find('button');
    await cancelButton.trigger('click');

    expect(component.emitted('cancel-selection')).toBeTruthy();
  });

  it('shows selected size when totalSelectedSize > 0', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: { ...defaultProps, isSelectionMode: true, selectedCount: 2, totalSelectedSize: 1024 },
    });

    expect(component.text()).toContain('1024 B');
  });

  it('renders breadcrumbs when not in selection mode', async () => {
    const component = await mountSuspended(MobileFileBrowserNavbar, {
      props: {
        ...defaultProps,
        breadcrumbs: [
          { name: 'Root', path: '/' },
          { name: 'Folder', path: '/folder' },
        ],
      },
    });

    expect(component.text()).toContain('Root');
    expect(component.text()).toContain('Folder');
  });
});
