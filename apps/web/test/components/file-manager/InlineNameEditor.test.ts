import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';

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
        existingNames: [],
      },
    });

    const input = wrapper.find('input');
    expect((input.element as HTMLInputElement).value).toBe('test.mp4');
  });

  it('emits save on enter if valid', async () => {
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: [],
      },
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
        existingNames: [],
      },
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
        existingNames: ['duplicate.mp4'],
      },
    });

    const input = wrapper.find('input');
    await input.setValue('duplicate.mp4');

    // Check computed if possible, or just the class
    expect(input.classes()).toContain('border-red-500');
  });

  it('does not cancel and refocusses when blur relatedTarget is parent with data-entry-path', async () => {
    const container = document.createElement('div');
    container.setAttribute('data-entry-path', 'some-path');
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: [],
      },
      attachTo: container,
    });

    await nextTick();

    const inputWrapper = wrapper.find('input');
    const inputEl = inputWrapper.element as HTMLInputElement;
    const focusSpy = vi.spyOn(inputEl, 'focus');

    await inputWrapper.trigger('blur', {
      relatedTarget: container,
    });

    expect(focusSpy).toHaveBeenCalled();
    expect(wrapper.emitted('cancel')).toBeFalsy();
    wrapper.unmount();
  });

  it('cancels on blur when relatedTarget is general container (contains input but has no data-entry-path)', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: [],
      },
      attachTo: container,
    });

    await nextTick();
    vi.advanceTimersByTime(150);

    const inputWrapper = wrapper.find('input');
    await inputWrapper.trigger('blur', {
      relatedTarget: container,
    });

    vi.advanceTimersByTime(200);

    expect(wrapper.emitted('cancel')).toBeTruthy();
    wrapper.unmount();
    vi.useRealTimers();
  });

  it('cancels on blur when relatedTarget is not parent and ready', async () => {
    vi.useFakeTimers();
    const wrapper = mount(InlineNameEditor, {
      props: {
        initialName: 'test.mp4',
        isFolder: false,
        existingNames: [],
      },
    });

    // Wait for Vue's nextTick so that the setTimeout in onMounted gets registered
    await nextTick();

    // Advance to trigger ready state setTimeout
    vi.advanceTimersByTime(150);

    const inputWrapper = wrapper.find('input');
    await inputWrapper.trigger('blur');

    // Advance to trigger blurTimer (150ms)
    vi.advanceTimersByTime(200);

    expect(wrapper.emitted('cancel')).toBeTruthy();
    wrapper.unmount();
    vi.useRealTimers();
  });
});
