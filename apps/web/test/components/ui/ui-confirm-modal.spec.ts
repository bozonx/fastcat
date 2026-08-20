import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const stubs = {
  UiModal: {
    template: `
      <div v-if="open" class="ui-modal-stub">
        <h1>{{ title }}</h1>
        <p v-if="description">{{ description }}</p>
        <slot />
        <slot name="footer" />
      </div>
    `,
    props: ['open', 'title', 'description', 'ui'],
  },
};

describe('UiConfirmModal', () => {
  it('renders correctly with given props', async () => {
    const component = await mountSuspended(UiConfirmModal, {
      global: { stubs },
      props: {
        title: 'Test Title',
        description: 'Test Description',
        icon: 'i-heroicons-information-circle',
        confirmText: 'Yes',
        cancelText: 'No',
        secondaryText: 'Maybe',
        open: true,
      },
    });

    const html = component.html();
    expect(html).toContain('Test Title');
    expect(html).toContain('Test Description');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
    expect(html).toContain('Maybe');
  });

  it('emits confirm event on primary button click', async () => {
    vi.useFakeTimers();
    try {
      const component = await mountSuspended(UiConfirmModal, {
        global: { stubs },
        props: {
          title: 'Confirm Action',
          confirmText: 'Confirm',
          open: true,
        },
      });

      const confirmButton = component
        .findAll('button')
        .find((btn) => btn.text().includes('Confirm'));
      expect(confirmButton).toBeDefined();

      await confirmButton!.trigger('click');

      vi.runAllTimers();

      expect(component.emitted('confirm')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits secondary event on secondary button click', async () => {
    vi.useFakeTimers();
    try {
      const component = await mountSuspended(UiConfirmModal, {
        global: { stubs },
        props: {
          title: 'Confirm Action',
          secondaryText: 'Secondary',
          open: true,
        },
      });

      const secondaryButton = component
        .findAll('button')
        .find((btn) => btn.text().includes('Secondary'));
      expect(secondaryButton).toBeDefined();

      await secondaryButton!.trigger('click');

      vi.runAllTimers();

      expect(component.emitted('secondary')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits update:open with false on cancel button click', async () => {
    const component = await mountSuspended(UiConfirmModal, {
      global: { stubs },
      props: {
        title: 'Confirm Action',
        cancelText: 'Cancel',
        open: true,
      },
    });

    const cancelButton = component.findAll('button').find((btn) => btn.text().includes('Cancel'));
    expect(cancelButton).toBeDefined();

    await cancelButton!.trigger('click');

    expect(component.emitted('update:open')).toBeTruthy();
    expect(component.emitted('update:open')?.[0]).toEqual([false]);
  });
});
