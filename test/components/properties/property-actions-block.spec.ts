import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PropertyActionsBlock from '~/components/properties/PropertyActionsBlock.vue';

vi.mock('~/components/properties/PropertyActionList.vue', () => ({
  default: {
    props: ['actions', 'vertical', 'variant', 'size', 'justify'],
    template:
      '<div class="action-list-mock" :data-count="actions?.length" :data-vertical="vertical" :data-variant="variant" :data-justify="justify" />',
  },
}));

describe('PropertyActionsBlock', () => {
  it('renders nothing when no actions provided', async () => {
    const component = await mountSuspended(PropertyActionsBlock);

    expect(component.findAll('.action-list-mock').length).toBe(0);
  });

  it('renders quick actions list when provided', async () => {
    const component = await mountSuspended(PropertyActionsBlock, {
      props: {
        quickActions: [
          { id: 'cut', icon: 'i-heroicons-scissors', onClick: vi.fn() },
          { id: 'copy', icon: 'i-heroicons-document', onClick: vi.fn() },
        ],
      },
    });

    const lists = component.findAll('.action-list-mock');
    expect(lists.length).toBe(1);
    expect(lists[0].attributes('data-count')).toBe('2');
    expect(lists[0].attributes('data-vertical')).toBe('false');
  });

  it('renders additional actions list when provided', async () => {
    const component = await mountSuspended(PropertyActionsBlock, {
      props: {
        additionalActions: [{ id: 'delete', icon: 'i-heroicons-trash', onClick: vi.fn() }],
      },
    });

    const lists = component.findAll('.action-list-mock');
    expect(lists.length).toBe(1);
    expect(lists[0].attributes('data-justify')).toBe('start');
  });

  it('renders both quick and additional action lists', async () => {
    const component = await mountSuspended(PropertyActionsBlock, {
      props: {
        quickActions: [{ id: 'cut', icon: 'i-heroicons-scissors', onClick: vi.fn() }],
        additionalActions: [{ id: 'delete', icon: 'i-heroicons-trash', onClick: vi.fn() }],
      },
    });

    const lists = component.findAll('.action-list-mock');
    expect(lists.length).toBe(2);
  });

  it('does not render quick actions list when empty', async () => {
    const component = await mountSuspended(PropertyActionsBlock, {
      props: { quickActions: [] },
    });

    expect(component.findAll('.action-list-mock').length).toBe(0);
  });
});
