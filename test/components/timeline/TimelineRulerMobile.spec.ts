import { describe, expect, it } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';

describe('TimelineRuler Mobile Behavior', () => {
  it('disables UContextMenu popover and mounts UiMobileDrawer when isMobile is true', async () => {
    const wrapper = await mountSuspended(TimelineRuler, {
      props: {
        scrollEl: null,
        scrollLeft: 0,
        isMobile: true,
      },
      global: {
        stubs: {
          UContextMenu: {
            props: ['disabled', 'open'],
            template:
              '<div class="u-context-menu-stub" :data-disabled="disabled" :data-open="open"><slot /></div>',
          },
          UiMobileDrawer: {
            props: ['open', 'title'],
            template:
              '<div class="ui-mobile-drawer-stub" :data-open="open" :data-title="title"><slot /></div>',
          },
          TimelineRulerOverlays: {
            template: '<div class="overlays-stub" />',
          },
        },
      },
    });

    const contextMenu = wrapper.find('.u-context-menu-stub');
    expect(contextMenu.attributes('data-disabled')).toBe('true');
    expect(contextMenu.attributes('data-open')).toBe('false');

    const drawer = wrapper.find('.ui-mobile-drawer-stub');
    expect(drawer.exists()).toBe(true);
  });
});
