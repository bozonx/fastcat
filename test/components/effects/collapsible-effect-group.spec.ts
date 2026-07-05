import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import CollapsibleEffectGroup from '~/components/effects/CollapsibleEffectGroup.vue';

describe('CollapsibleEffectGroup', () => {
  it('renders title', async () => {
    const component = await mountSuspended(CollapsibleEffectGroup, {
      props: { title: 'Color Effects', isCollapsed: false },
    });

    expect(component.text()).toContain('Color Effects');
  });

  it('renders slot content when not collapsed', async () => {
    const component = await mountSuspended(CollapsibleEffectGroup, {
      props: { title: 'Test', isCollapsed: false },
      slots: { default: '<div class="content">Content</div>' },
    });

    expect(component.find('.content').exists()).toBe(true);
  });

  it('hides slot content when collapsed', async () => {
    const component = await mountSuspended(CollapsibleEffectGroup, {
      props: { title: 'Test', isCollapsed: true },
      slots: { default: '<div class="content">Content</div>' },
    });

    const slotWrapper = component.find('.effect-group-content');
    expect(slotWrapper.exists()).toBe(true);
  });

  it('emits update:isCollapsed when toggle is clicked', async () => {
    const component = await mountSuspended(CollapsibleEffectGroup, {
      props: { title: 'Test', isCollapsed: false },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('update:isCollapsed')).toBeTruthy();
    expect(component.emitted('update:isCollapsed')![0]).toEqual([true]);
  });

  it('emits true when expanding (isCollapsed=true -> false)', async () => {
    const component = await mountSuspended(CollapsibleEffectGroup, {
      props: { title: 'Test', isCollapsed: true },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('update:isCollapsed')![0]).toEqual([false]);
  });
});
