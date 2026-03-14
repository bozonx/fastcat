import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import { useEditorHotkeys } from '../../../../src/composables/editor/useEditorHotkeys';
import { useFocusStore } from '../../../../src/stores/focus.store';
import { useProjectStore } from '../../../../src/stores/project.store';
import { useSelectionStore } from '../../../../src/stores/selection.store';
import { useTimelineStore } from '../../../../src/stores/timeline.store';
import { useUiStore } from '../../../../src/stores/ui.store';

const HotkeysHarness = defineComponent({
  setup() {
    useEditorHotkeys();
    return () => h('div');
  },
});

describe('useEditorHotkeys', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('toggles focus on Tab when editor is in cut view', async () => {
    const wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');
    expect(focusStore.activePanelId).toBe('monitor');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('timeline');
    await wrapper.unmount();
  });

  it('ignores non-repeatable commands on repeated keydown', async () => {
    const wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', repeat: true, bubbles: true }),
    );

    expect(focusStore.activePanelId).toBe('monitor');
    await wrapper.unmount();
  });

  it('blocks timeline hotkeys when editable element is active', async () => {
    const wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    const splitClipAtPlayheadSpy = vi.fn().mockResolvedValue(undefined);
    timelineStore.splitClipAtPlayhead = splitClipAtPlayheadSpy;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', bubbles: true }));

    expect(splitClipAtPlayheadSpy).not.toHaveBeenCalled();

    input.remove();
    await wrapper.unmount();
  });

  it('allows Escape-based deselect even when editable element is active', async () => {
    const wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    selectionStore.selectTimelineMarker('marker-1');
    timelineStore.selectedItemIds = ['clip-1'];
    timelineStore.selectedTrackId = 'track-1';

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );

    expect(selectionStore.selectedEntity).toBeNull();
    expect(timelineStore.selectedItemIds).toEqual([]);
    expect(timelineStore.selectedTrackId).toBeNull();

    input.remove();
    await wrapper.unmount();
  });

  it('blocks non-escape global hotkeys while modal state is active', async () => {
    const wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const uiStore = useUiStore();

    projectStore.setView('cut');
    uiStore.activeModalsCount = 1;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('monitor');
    await wrapper.unmount();
  });
});
