import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';

describe('FileBrowserBreadcrumbs', () => {
  const parentFolders = [
    { name: 'Root', kind: 'directory', path: '' },
    { name: 'Videos', kind: 'directory', path: 'videos' },
    { name: 'Summer', kind: 'directory', path: 'videos/summer' },
  ];

  it('renders all breadcrumbs', () => {
    const wrapper = mount(FileBrowserBreadcrumbs, {
      props: {
        parentFolders: parentFolders as any,
      },
      global: {
        stubs: {
          UButton: true,
          UIcon: true
        }
      }
    });

    expect(wrapper.text()).toContain('Root');
    expect(wrapper.text()).toContain('Videos');
    expect(wrapper.text()).toContain('Summer');
  });

  it('emits navigateToFolder on breadcrumb click', async () => {
    const wrapper = mount(FileBrowserBreadcrumbs, {
      props: {
        parentFolders: parentFolders as any,
      },
      global: {
        stubs: {
          UButton: true,
          UIcon: true
        }
      }
    });

    const rootBtn = wrapper.findAll('button').find(b => b.text().includes('Root'));
    await rootBtn?.trigger('click');

    expect(wrapper.emitted('navigateToFolder')).toBeTruthy();
    expect(wrapper.emitted('navigateToFolder')?.[0]).toEqual([0]);
  });
});
