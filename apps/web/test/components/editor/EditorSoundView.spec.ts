import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorSoundView from '~/components/editor/EditorSoundView.vue';

vi.mock('splitpanes', () => ({
  Splitpanes: {
    emits: ['resized'],
    template:
      '<div class="splitpanes-stub"><slot /><button class="emit-resized" @click="$emit(\'resized\', { panes: [{ size: 50 }, { size: 50 }] })" /></div>',
  },
  Pane: {
    props: ['size', 'minSize'],
    template: '<div class="pane-stub"><slot /></div>',
  },
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => ({ id: 'fm-mock' }),
}));

describe('EditorSoundView', () => {
  const noop = () => undefined;

  const stubs = {
    AudioMixer: { template: '<div class="audio-mixer-stub" />' },
    EditorDynamicPanelsView: {
      props: [
        'leftPanelType',
        'rightPanelType',
        'view',
        'columns',
        'topSizes',
        'draggingPanelId',
        'dragOverPanelId',
        'dropPosition',
        'getVerticalSize',
        'isFocused',
        'getFocusId',
        'panelDndZoneAttrs',
      ],
      template: '<div class="editor-dynamic-panels-stub" />',
    },
  };

  const baseProps = {
    sizes: [30, 70],
    columns: [],
    topSizes: [],
    draggingPanelId: null,
    dragOverPanelId: null,
    dropPosition: null,
    getVerticalSize: noop,
    isFocused: () => false,
    getFocusId: () => 'focus-1',
    panelDndZoneAttrs: {},
  };

  it('renders AudioMixer and EditorDynamicPanelsView', async () => {
    const component = await mountSuspended(EditorSoundView, {
      props: baseProps,
      global: { stubs },
    });

    expect(component.find('.audio-mixer-stub').exists()).toBe(true);
    expect(component.find('.editor-dynamic-panels-stub').exists()).toBe(true);
  });

  it('emits resized event', async () => {
    const component = await mountSuspended(EditorSoundView, {
      props: baseProps,
      global: { stubs },
    });

    await component.find('.emit-resized').trigger('click');

    expect(component.emitted('resized')).toBeTruthy();
  });
});
