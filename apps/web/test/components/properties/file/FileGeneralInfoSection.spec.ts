import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileGeneralInfoSection from '~/components/properties/file/FileGeneralInfoSection.vue';

vi.mock('#imports', () => ({
  useI18n: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('FileGeneralInfoSection', () => {
  it('renders directory size when it is available', () => {
    const wrapper = mount(FileGeneralInfoSection, {
      props: {
        title: 'General Info',
        fileInfo: {
          kind: 'directory',
          name: 'assets',
          size: 2048,
        },
        selectedPath: 'assets',
        isHidden: false,
        formatBytes: (bytes: number) => `${bytes / 1024} KB`,
      },
      global: {
        stubs: {
          NuxtLink: {
            props: ['to'],
            template: '<a><slot /></a>',
          },
        },
      },
    });

    expect(wrapper.text()).toContain('2 KB');
  });
});
