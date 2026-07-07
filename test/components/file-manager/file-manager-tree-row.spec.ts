import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import FileManagerTreeRow from '~/components/file-manager/FileManagerTreeRow.vue';
import type { FsEntry } from '~/types/fs';

vi.mock('~/components/ui/UiProgressSpinner.vue', () => ({
  default: {
    props: ['progress', 'size'],
    template: '<div class="spinner-mock" />',
  },
}));

vi.mock('~/components/file-manager/InlineNameEditor.vue', () => ({
  default: {
    props: ['initialName', 'existingNames'],
    emits: ['commit', 'cancel'],
    template:
      '<input class="inline-editor" :value="initialName" @input="$emit(\'commit\', $event.target.value)" />',
  },
}));

const sampleEntry: FsEntry = {
  path: '/test/file.mp4',
  name: 'file.mp4',
  isDirectory: false,
  size: 1024,
  lastModified: 0,
} as unknown as FsEntry;

describe('FileManagerTreeRow', () => {
  const defaultProps = {
    entry: sampleEntry,
    depth: 0,
    isDragOver: false,
    existingNames: [],
    fileIcon: 'i-heroicons-document',
    selected: false,
    showChevron: false,
    iconClass: '',
    nameClass: '',
    meta: { hasProxy: false, generatingProxy: false },
  };

  it('renders with entry name', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: defaultProps,
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('file.mp4');
  });

  it('applies padding based on depth', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: { ...defaultProps, depth: 2 },
    });

    const row = component.find('[data-entry-path]');
    expect(row.attributes('style')).toContain('padding-left: 36px');
  });

  it('emits click event', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: defaultProps,
    });

    const row = component.find('[data-entry-path]');
    await row.trigger('click');

    expect(component.emitted('click')).toBeTruthy();
  });

  it('emits dblclick event', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: defaultProps,
    });

    const row = component.find('[data-entry-path]');
    await row.trigger('dblclick');

    expect(component.emitted('dblclick')).toBeTruthy();
  });

  it('shows chevron when showChevron is true', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: { ...defaultProps, showChevron: true },
    });

    const chevrons = component.findAll('.icon-mock');
    expect(chevrons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows progress spinner when generating proxy', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: {
        ...defaultProps,
        meta: { hasProxy: false, generatingProxy: true, proxyProgress: 50 },
      },
    });

    expect(component.find('.spinner-mock').exists()).toBe(true);
  });

  it('applies selected class when selected is true', async () => {
    const component = await mountSuspended(FileManagerTreeRow, {
      props: { ...defaultProps, selected: true },
    });

    const row = component.find('[data-entry-path]');
    expect(row.classes()).toContain('bg-(--selection-range-bg)');
    expect(row.classes()).toContain('hover:bg-(--selection-range-bg)');
  });
});
