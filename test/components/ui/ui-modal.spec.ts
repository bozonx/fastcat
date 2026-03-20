import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiModal from '~/components/ui/UiModal.vue';

// Mock the composable directly instead of the whole module
vi.mock('~/composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('UiModal', () => {
  it('renders correctly when open', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
        title: 'Test Modal',
        description: 'Test Description',
      },
      slots: {
        default: '<div class="test-content">Content</div>',
      },
    });

    // For UModal, we might need to check document.body because of teleport
    expect(document.body.innerHTML).toContain('Test Modal');
    expect(document.body.innerHTML).toContain('Test Description');
    expect(document.body.innerHTML).toContain('test-content');
  });

  it('renders header and footer slots', async () => {
    const component = await mountSuspended(UiModal, {
      props: {
        open: true,
      },
      slots: {
        header: '<div class="custom-header">Header</div>',
        default: 'Body',
        footer: '<div class="custom-footer">Footer</div>',
      },
    });

    expect(document.body.innerHTML).toContain('custom-header');
    expect(document.body.innerHTML).toContain('custom-footer');
  });
});
