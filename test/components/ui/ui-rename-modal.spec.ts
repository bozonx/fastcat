import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import { nextTick } from 'vue';

const stubs = {
  UiModal: {
    template:
      '<div><h1>{{ title }}</h1><slot name="header"></slot><slot></slot><slot name="footer"></slot></div>',
    props: ['open', 'title'],
  },
};

describe('UiRenameModal', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: true,
        title: 'Custom Rename Title',
      },
      global: { stubs },
    });

    const html = component.html();
    expect(html).toContain('Custom Rename Title');
    expect(component.find('form').exists()).toBe(true);
    expect(component.find('input').exists()).toBe(true);
  });

  it('initializes input with initialName on open', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: false,
        initialName: 'Start Name',
      },
      global: { stubs },
    });

    await component.setProps({ open: true });
    await nextTick();

    const input = component.find('input');
    expect((input.element as HTMLInputElement).value).toBe('Start Name');
  });

  it('initializes input with currentName if initialName is not provided', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: false,
        currentName: 'Current File Name',
      },
      global: { stubs },
    });

    await component.setProps({ open: true });
    await nextTick();

    const input = component.find('input');
    expect((input.element as HTMLInputElement).value).toBe('Current File Name');
  });

  it('emits rename event and closes modal on save click', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: true,
        initialName: 'Test File',
      },
      global: { stubs },
    });

    const input = component.find('input');
    await input.setValue('New File Name');

    const saveButton = component.findAll('button').find((btn) => btn.text().includes('common.confirm'));
    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');

    expect(component.emitted('rename')).toBeTruthy();
    expect(component.emitted('rename')?.[0]).toEqual(['New File Name']);

    expect(component.emitted('update:open')).toBeTruthy();
    expect(component.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('trims the name before emitting rename', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: true,
        initialName: 'Test',
      },
      global: { stubs },
    });

    const input = component.find('input');
    await input.setValue('  Padded Name  ');

    const form = component.find('form');
    await form.trigger('submit.prevent');

    expect(component.emitted('rename')).toBeTruthy();
    expect(component.emitted('rename')?.[0]).toEqual(['Padded Name']);
  });

  it('does not emit rename if the name is empty or only whitespace', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: true,
      },
      global: { stubs },
    });

    const input = component.find('input');
    await input.setValue('   ');

    const form = component.find('form');
    await form.trigger('submit.prevent');

    expect(component.emitted('rename')).toBeFalsy();
    // Save button should also be disabled in this state
    const saveButton = component.findAll('button').find((btn) => btn.text().includes('common.confirm'));
    expect(saveButton?.attributes('disabled')).toBeDefined();
  });

  it('closes modal on cancel click', async () => {
    const component = await mountSuspended(UiRenameModal, {
      props: {
        open: true,
      },
      global: { stubs },
    });

    const cancelButton = component.findAll('button').find((btn) => btn.text().includes('common.cancel'));
    expect(cancelButton).toBeDefined();

    await cancelButton!.trigger('click');

    expect(component.emitted('update:open')).toBeTruthy();
    expect(component.emitted('update:open')?.[0]).toEqual([false]);
  });
});
