import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsMouseSection from '~/components/settings/SettingsMouseSection.vue';

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: {
    props: ['title'],
    template: '<div class="header-mock">{{ title }}</div>',
  },
}));

describe('SettingsMouseSection', () => {
  it('renders section title', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Mouse Settings', infoItems: [] },
    });

    expect(component.text()).toContain('Mouse Settings');
  });

  it('renders table with slot content', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Test', infoItems: [] },
      slots: { default: '<tr><td>Row content</td></tr>' },
    });

    expect(component.find('table').exists()).toBe(true);
    expect(component.text()).toContain('Row content');
  });

  it('renders info items when provided', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Test', infoItems: ['Tip 1', 'Tip 2'] },
    });

    const listItems = component.findAll('li');
    expect(listItems.length).toBe(2);
  });

  it('does not render info section when infoItems is empty', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Test', infoItems: [] },
    });

    expect(component.find('ul').exists()).toBe(false);
  });

  it('renders info title when provided', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Test', infoTitle: 'Info', infoItems: ['Tip'] },
    });

    expect(component.text()).toContain('Info');
  });

  it('applies grid layout when infoColumns is true', async () => {
    const component = await mountSuspended(SettingsMouseSection, {
      props: { title: 'Test', infoItems: ['A', 'B'], infoColumns: true },
    });

    expect(component.find('ul.grid').exists()).toBe(true);
  });
});
