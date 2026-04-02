import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import { useEditorHotkeys } from '~/composables/editor/useEditorHotkeys';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';

const HotkeysHarness = defineComponent({
  setup() {
    useEditorHotkeys();
    return () => h('div');
  },
});

describe('useEditorHotkeys', () => {
  let wrapper: VueWrapper<InstanceType<typeof HotkeysHarness>> | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    pressedKeyCodes.clear();
    wrapper = undefined;
  });

  afterEach(async () => {
    await wrapper?.unmount();
    wrapper = undefined;
    pressedKeyCodes.clear();
  });

  it('toggles focus on Tab when editor is in cut view', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');
    expect(focusStore.activePanelId).toBe('timeline');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('monitor');
  });

  it('ignores non-repeatable commands on repeated keydown', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', repeat: true, bubbles: true }),
    );

    expect(focusStore.activePanelId).toBe('timeline');
  });

  it('blocks timeline hotkeys when editable element is active', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
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
  });

  it('allows Escape-based deselect even when editable element is active', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
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
  });

  it('blocks non-escape global hotkeys while modal state is active', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);

    try {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }),
      );

      expect(focusStore.activePanelId).toBe('timeline');
    } finally {
      dialog.remove();
    }
  });

  it('toggles current toolbar snap mode with T when timeline hotkeys are active', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const settingsStore = useTimelineSettingsStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    settingsStore.selectToolbarSnapMode('snap');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    expect(settingsStore.toolbarSnapMode).toBe('no_snap');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    expect(settingsStore.toolbarSnapMode).toBe('snap');
  });
});
