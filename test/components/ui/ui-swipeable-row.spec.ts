import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiSwipeableRow from '~/components/ui/UiSwipeableRow.vue';

describe('UiSwipeableRow', () => {
  it('renders default slot content', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div class="row-content">Row content</div>',
        actions:
          '<template #actions="{ close }"><button class="action-btn" @click="close">Delete</button></template>',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.row-content').exists()).toBe(true);
  });

  it('renders actions slot', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div>Content</div>',
        actions: '<div class="actions-content"><button>Delete</button></div>',
      },
    });

    expect(component.find('.actions-content').exists()).toBe(true);
  });

  it('exposes open and close methods', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div>Content</div>',
        actions: '<div><button>Delete</button></div>',
      },
    });

    expect(typeof component.vm.open).toBe('function');
    expect(typeof component.vm.close).toBe('function');
  });

  it('emits swipe-open when open is called', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div>Content</div>',
        actions: '<div><button>Delete</button></div>',
      },
    });

    component.vm.open();
    await component.vm.$nextTick();

    expect(component.emitted('swipe-open')).toBeTruthy();
  });

  it('emits swipe-close when close is called', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div>Content</div>',
        actions: '<div><button>Delete</button></div>',
      },
    });

    component.vm.close();
    await component.vm.$nextTick();

    expect(component.emitted('swipe-close')).toBeTruthy();
  });

  it('has touch-pan-y class on container', async () => {
    const component = await mountSuspended(UiSwipeableRow, {
      slots: {
        default: '<div>Content</div>',
        actions: '<div><button>Delete</button></div>',
      },
    });

    expect(component.find('.touch-pan-y').exists()).toBe(true);
  });
});
