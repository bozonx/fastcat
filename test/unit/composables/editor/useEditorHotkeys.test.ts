import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

import { useEditorHotkeys } from '../~/composables/editor/useEditorHotkeys';
import { useFocusStore } from '../~/stores/focus.store';
import { useProjectStore } from '../~/stores/project.store';
import { useSelectionStore } from '../~/stores/selection.store';
import { useTimelineSettingsStore } from '../~/stores/timelineSettings.store';
import { useTimelineStore } from '../~/stores/timeline.store';
import { useUiStore } from '../~/stores/ui.store';

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
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('monitor');
    await wrapper.unmount();
    if (typeof dialog !== 'undefined') dialog?.remove();
  });

  it('toggles current toolbar move mode with T when timeline hotkeys are active', async () => {
    const wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const settingsStore = useTimelineSettingsStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    settingsStore.selectToolbarDragMode('slip');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    expect(settingsStore.toolbarDragMode).toBe('pseudo_overlap');
    expect(settingsStore.toolbarDragModeEnabled).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    expect(settingsStore.toolbarDragMode).toBe('pseudo_overlap');
    expect(settingsStore.toolbarDragModeEnabled).toBe(false);

    await wrapper.unmount();
  });
});
