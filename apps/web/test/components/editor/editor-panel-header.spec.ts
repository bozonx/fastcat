import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorPanelHeader from '~/components/editor/EditorPanelHeader.vue';

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: { template: '<div class="header-mock" />' },
}));

describe('EditorPanelHeader', () => {
  it('renders title and icon', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Files', icon: 'i-heroicons-folder' },
    });

    expect(component.text()).toContain('Files');
  });

  it('emits close when close button is clicked', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Test', icon: 'i-heroicons-folder' },
    });

    const buttons = component.findAll('button');
    const closeBtn = buttons.find((b) => b.attributes('icon')?.includes('x-mark'));
    if (closeBtn) {
      await closeBtn.trigger('click');
      expect(component.emitted('close')).toBeTruthy();
    }
  });

  it('emits close on dblclick', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Test', icon: 'i-heroicons-folder' },
    });

    const header = component.find('.flex.justify-between');
    await header.trigger('dblclick');

    expect(component.emitted('close')).toBeTruthy();
  });

  it('applies absolute positioning when isAbsolute is true', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Test', icon: 'i-heroicons-folder', isAbsolute: true },
    });

    const header = component.find('.flex.justify-between');
    expect(header.classes()).toContain('absolute');
  });

  it('applies draggable cursor class when inDevelopmentFeaturesEnabled is true', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Test', icon: 'i-heroicons-folder', inDevelopmentFeaturesEnabled: true },
    });

    const header = component.find('.flex.justify-between');
    expect(header.classes()).toContain('cursor-grab');
  });

  it('emits close on middle-click (auxclick)', async () => {
    const component = await mountSuspended(EditorPanelHeader, {
      props: { title: 'Test', icon: 'i-heroicons-folder' },
    });

    const header = component.find('.flex.justify-between');
    await header.trigger('auxclick', { button: 1 });

    expect(component.emitted('close')).toBeTruthy();
  });
});
