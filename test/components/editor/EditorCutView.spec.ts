import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorCutView from '~/components/editor/EditorCutView.vue';
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';

describe('EditorCutView', () => {
  it('renders EditorDynamicPanelsView with correct props', async () => {
    const getVerticalSize = vi.fn();
    const isFocused = vi.fn();
    const getFocusId = vi.fn();

    const component = await mountSuspended(EditorCutView, {
      props: {
        columns: [],
        layoutKey: 'cut-layout',
        topSizes: [],
        draggingPanelId: null,
        dragOverPanelId: null,
        dropPosition: null,
        getVerticalSize,
        isFocused,
        getFocusId,
      },
      global: {
        stubs: {
          EditorDynamicPanelsView: {
            template: '<div class="mock-dynamic-panels"></div>',
            props: [
              'view',
              'columns',
              'layoutKey',
              'topSizes',
              'draggingPanelId',
              'dragOverPanelId',
              'dropPosition',
              'getVerticalSize',
              'isFocused',
              'getFocusId',
              'leftPanelType',
              'rightPanelType',
            ],
          },
        },
      },
    });

    const child = component.findComponent(EditorDynamicPanelsView);
    expect(child.exists()).toBe(true);
    expect(child.props('view')).toBe('cut');
    expect(child.props('leftPanelType')).toBe('files');
    expect(child.props('rightPanelType')).toBe('monitor');
    expect(child.props('layoutKey')).toBe('cut-layout');
  });
});
