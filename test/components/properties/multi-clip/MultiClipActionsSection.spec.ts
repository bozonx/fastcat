import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MultiClipActionsSection from '~/components/properties/multi-clip/MultiClipActionsSection.vue';

describe('MultiClipActionsSection.vue', () => {
  const defaultProps = {
    selectedCountLabel: 'Selected 2 clips',
    commonActions: [
      { id: 'copy', title: 'Copy', icon: 'i-heroicons-document-duplicate', onClick: () => {} },
      { id: 'delete', title: 'Delete', icon: 'i-heroicons-trash', onClick: () => {} },
    ],
    otherActions: [
      { id: 'group', label: 'Group', icon: 'i-heroicons-link', onClick: () => {} },
    ],
  };

  it('passes quickActions when isMobile is false', async () => {
    const wrapper = await mountSuspended(MultiClipActionsSection, {
      props: { ...defaultProps, isMobile: false },
      global: {
        stubs: {
          PropertySection: {
            template: '<div class="property-section"><slot /></div>',
          },
          PropertyActionsBlock: {
            props: ['quickActions', 'additionalActions'],
            template: '<div data-testid="actions-block" :data-quick="JSON.stringify(quickActions)" :data-additional="JSON.stringify(additionalActions)" />',
          },
        },
      },
    });

    const actionsBlock = wrapper.find('[data-testid="actions-block"]');
    expect(actionsBlock.exists()).toBe(true);
    const quick = JSON.parse(actionsBlock.attributes('data-quick') ?? '[]');
    expect(quick.length).toBe(2);
    expect(quick[0].id).toBe('copy');
  });

  it('passes empty quickActions when isMobile is true', async () => {
    const wrapper = await mountSuspended(MultiClipActionsSection, {
      props: { ...defaultProps, isMobile: true },
      global: {
        stubs: {
          PropertySection: {
            template: '<div class="property-section"><slot /></div>',
          },
          PropertyActionsBlock: {
            props: ['quickActions', 'additionalActions'],
            template: '<div data-testid="actions-block" :data-quick="JSON.stringify(quickActions)" :data-additional="JSON.stringify(additionalActions)" />',
          },
        },
      },
    });

    const actionsBlock = wrapper.find('[data-testid="actions-block"]');
    expect(actionsBlock.exists()).toBe(true);
    const quick = JSON.parse(actionsBlock.attributes('data-quick') ?? '[]');
    expect(quick.length).toBe(0);
    const additional = JSON.parse(actionsBlock.attributes('data-additional') ?? '[]');
    expect(additional.length).toBe(1);
  });
});
