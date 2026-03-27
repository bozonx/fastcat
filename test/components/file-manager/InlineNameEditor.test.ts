import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.stubGlobal('useToast', () => ({
  add: vi.fn(),
}));

describe('InlineNameEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial name', () => {
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: []
      }
    });

    const input = wrapper.find('input');
    expect((input.element as HTMLInputElement).value).toBe('test.mp4');
  });

  it('emits save on enter if valid', async () => {
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: []
      }
    });

    const input = wrapper.find('input');
    await input.setValue('new-name.mp4');
    await input.trigger('keydown.enter');

    expect(wrapper.emitted('save')).toBeTruthy();
    expect(wrapper.emitted('save')?.[0]).toEqual(['new-name.mp4']);
  });

  it('emits cancel on esc', async () => {
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: []
      }
    });

    const input = wrapper.find('input');
    await input.trigger('keydown.esc');

    expect(wrapper.emitted('cancel')).toBeTruthy();
  });

  it('detects invalid names (existing names)', async () => {
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: ['duplicate.mp4']
      }
    });

    const input = wrapper.find('input');
    await input.setValue('duplicate.mp4');
    
    // Check computed if possible, or just the class
    expect(input.classes()).toContain('border-red-500');
  });
});
