import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileInfoModal from '~/components/file-manager/FileInfoModal.vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('FileInfoModal', () => {
  it('renders file information correctly', () => {
    const info = {
      name: 'video.mp4',
      kind: 'file',
      size: 1048576 * 5, // 5 MB
      lastModified: new Date('2023-01-01').getTime(),
      metadata: { codec: 'h264', resolution: '1920x1080' }
    };

    const wrapper = mount(FileInfoModal, {
      props: {
        open: true,
        info: info as any
      },
      global: {
        stubs: {
          UiModal: { template: '<div><slot /></div>' },
          UButton: true
        }
      }
    });

    expect(wrapper.text()).toContain('video.mp4');
    expect(wrapper.text()).toContain('5.00 MB');
    expect(wrapper.text()).toContain('codec: h264');
  });

  it('renders nothing when info is null', () => {
    const wrapper = mount(FileInfoModal, {
      props: {
        open: true,
        info: null
      },
      global: {
        stubs: {
          UiModal: { template: '<div><slot /></div>' },
          UButton: true
        }
      }
    });

    expect(wrapper.find('.space-y-4').exists()).toBe(false);
  });
});
