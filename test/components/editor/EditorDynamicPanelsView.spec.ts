import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';

vi.mock('splitpanes', () => ({
  Splitpanes: { template: '<div class="splitpanes"><slot /></div>', emits: ['resized'] },
  Pane: { template: '<div class="pane"><slot /></div>', props: ['size', 'minSize'] },
}));

vi.mock('~/components/editor/EditorDynamicPanelContent.vue', () => ({
  default: {
    name: 'EditorDynamicPanelContent',
    template: '<div class="dynamic-panel-content">Content</div>',
    props: ['panel', 'view', 'focusPanelId'],
  },
}));

describe('EditorDynamicPanelsView', () => {
  const defaultProps = {
    view: 'cut' as const,
    columns: [
      {
        id: 'col-1',
        panels: [{ id: 'panel-1', type: 'files', title: 'Files' }],
      },
      {
        id: 'col-2',
        panels: [{ id: 'panel-2', type: 'monitor', title: 'Monitor' }],
      },
    ],
    layoutKey: 'test-layout',
    topSizes: [30, 70],
    getVerticalSize: vi.fn().mockReturnValue(100),
    draggingPanelId: null,
    dragOverPanelId: null,
    dropPosition: null,
    isFocused: vi.fn().mockReturnValue(false),
    getFocusId: vi.fn().mockReturnValue('files'),
    leftPanelType: 'files' as const,
    rightPanelType: 'monitor' as const,
  };

  it('renders columns and panels correctly', async () => {
    const component = await mountSuspended(EditorDynamicPanelsView, {
      props: defaultProps,
    });

    const panes = component.findAll('.pane');
    // 2 columns, each has 1 panel. Splitpanes also uses Pane.
    // Total panes = 2 (top) + 2 (inner) = 4 panes.
    expect(panes.length).toBe(4);

    const panelContents = component.findAll('.dynamic-panel-content');
    expect(panelContents.length).toBe(2);
  });

  it('applies focus classes when panel is focused', async () => {
    const component = await mountSuspended(EditorDynamicPanelsView, {
      props: {
        ...defaultProps,
        isFocused: (id: string) => id === 'panel-1',
      },
    });

    const focusFrames = component.findAll('.panel-focus-frame');
    expect(focusFrames[0].classes()).toContain('panel-focus-frame--active');
    expect(focusFrames[1].classes()).not.toContain('panel-focus-frame--active');
  });

  it('applies drag over classes correctly', async () => {
    const component = await mountSuspended(EditorDynamicPanelsView, {
      props: {
        ...defaultProps,
        dragOverPanelId: 'panel-2',
        dropPosition: 'right',
      },
    });

    const focusFrames = component.findAll('.panel-focus-frame');
    expect(focusFrames[1].classes()).toContain('border-r-2');
    expect(focusFrames[1].classes()).toContain('border-r-primary-500');
  });

  it('emits events correctly', async () => {
    const component = await mountSuspended(EditorDynamicPanelsView, {
      props: defaultProps,
    });

    const firstFrame = component.find('.panel-focus-frame');

    await firstFrame.trigger('click');
    expect(component.emitted('focus')).toBeTruthy();
    expect(component.emitted('focus')![0]).toEqual(['panel-1']);

    await firstFrame.trigger('dragover');
    expect(component.emitted('dragOver')).toBeTruthy();
    expect(component.emitted('dragOver')![0]).toEqual([expect.any(Event), 'panel-1', 'cut']);

    await firstFrame.trigger('drop');
    expect(component.emitted('drop')).toBeTruthy();
  });
});
