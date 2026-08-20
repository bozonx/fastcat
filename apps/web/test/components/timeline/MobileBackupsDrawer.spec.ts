import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileBackupsDrawer from '~/components/timeline/MobileBackupsDrawer.vue';

vi.mock('~/components/project/ProjectBackups.vue', () => ({
  default: { template: '<div class="project-backups-stub" />' },
}));

describe('MobileBackupsDrawer', () => {
  it('renders correctly when open', async () => {
    const wrapper = await mountSuspended(MobileBackupsDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            props: ['open'],
            template: '<div v-if="open" class="drawer-stub"><slot /></div>',
          },
          ProjectBackups: {
            template: '<div class="project-backups-stub" />',
          },
        },
      },
    });

    // Check that the drawer is rendered
    expect(wrapper.find('.drawer-stub').exists()).toBe(true);
    // Check that ProjectBackups component is rendered inside
    expect(wrapper.find('.project-backups-stub').exists()).toBe(true);
  });

  it('does not render when closed', async () => {
    const wrapper = await mountSuspended(MobileBackupsDrawer, {
      props: {
        isOpen: false,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            props: ['open'],
            template: '<div v-if="open" class="drawer-stub"><slot /></div>',
          },
          ProjectBackups: {
            template: '<div class="project-backups-stub" />',
          },
        },
      },
    });

    expect(wrapper.find('.drawer-stub').exists()).toBe(false);
  });
});
