/** @vitest-environment happy-dom */
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
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useClipboardStore } from '~/stores/clipboard.store';

const mockWorkspaceStore = {
  userSettings: {
    history: {
      maxEntries: 100,
    },
    hotkeys: {
      layer1: 'Shift',
      layer2: 'Control',
      bindings: {
        'general.focus': ['Tab'],
        'general.copy': ['Ctrl+C'],
      },
    },
    timeline: {
      defaultStaticClipDurationUs: 5000000,
    },
  },
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
  batchUpdateWorkspaceState: vi.fn(),
};

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    openProjectTab: vi.fn(),
    closeCurrentProjectTab: vi.fn(),
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => mockWorkspaceStore),
}));

vi.mock('#app', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
  }),
  useRoute: () => ({
    path: '/',
    params: {},
    query: {},
  }),
  useNuxtApp: () => ({
    $notificationService: { add: vi.fn() },
    $i18nService: { t: (key: string) => key },
  }),
}));

const HotkeysHarness = defineComponent({
  setup() {
    useEditorHotkeys();
  },
  render() {
    return h('div');
  },
});

describe('useEditorHotkeys', () => {
  let wrapper: VueWrapper<InstanceType<typeof HotkeysHarness>> | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    pressedKeyCodes.clear();
    useClipboardStore().clearClipboardPayload();
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'general.focus': ['Tab'],
      'general.copy': ['Ctrl+C'],
    };
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

  it('toggles focus on Tab even when general.focus is bound to another shortcut', async () => {
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'general.focus': ['/'],
      'general.copy': ['Ctrl+C'],
    };

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

  it('preserves native Tab navigation inside editable elements', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(focusStore.activePanelId).toBe('timeline');

    input.remove();
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

  it('prioritizes file manager copy when a file manager panel is focused', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const timelineStore = useTimelineStore() as any;
    const clipboardStore = useClipboardStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:file-manager:detached-files');
    selectionStore.selectFsEntry(
      {
        kind: 'file',
        name: 'clip.mp4',
        path: 'media/clip.mp4',
        parentPath: 'media',
        source: 'local',
      } as any,
      'detached-files',
    );

    timelineStore.selectedItemIds = ['timeline-clip-1'];
    const copySelectedClipsSpy = vi.fn(() => []);
    timelineStore.copySelectedClips = copySelectedClipsSpy;

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(copySelectedClipsSpy).not.toHaveBeenCalled();
    expect(clipboardStore.clipboardPayload).toEqual({
      source: 'fileManager',
      operation: 'copy',
      items: [
        {
          path: 'media/clip.mp4',
          kind: 'file',
          name: 'clip.mp4',
          source: 'local',
        },
      ],
      sourceInstanceId: 'detached-files',
    });
  });

  it('supports copy and cut from file properties focus for file manager selection', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const clipboardStore = useClipboardStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:properties:files-main');
    selectionStore.selectFsEntry(
      {
        kind: 'file',
        name: 'clip.mp4',
        path: 'media/clip.mp4',
        parentPath: 'media',
        source: 'local',
      } as any,
      'main',
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(clipboardStore.clipboardPayload).toEqual({
      source: 'fileManager',
      operation: 'copy',
      items: [
        {
          path: 'media/clip.mp4',
          kind: 'file',
          name: 'clip.mp4',
          source: 'local',
        },
      ],
      sourceInstanceId: 'main',
    });

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        code: 'KeyX',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(clipboardStore.clipboardPayload).toEqual({
      source: 'fileManager',
      operation: 'cut',
      items: [
        {
          path: 'media/clip.mp4',
          kind: 'file',
          name: 'clip.mp4',
          source: 'local',
        },
      ],
      sourceInstanceId: 'main',
    });
  });

  it('routes paste from file properties focus to the selected directory', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const clipboardStore = useClipboardStore();
    const uiStore = useUiStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:properties:files-main');
    selectionStore.selectFsEntry(
      {
        kind: 'directory',
        name: 'assets',
        path: 'assets',
        source: 'local',
      } as any,
      'main',
    );
    clipboardStore.setClipboardPayload({
      source: 'fileManager',
      operation: 'copy',
      items: [
        {
          path: 'media/clip.mp4',
          kind: 'file',
          name: 'clip.mp4',
          source: 'local',
        },
      ],
      sourceInstanceId: 'main',
    });

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(uiStore.pendingFsEntryPaste).toEqual({
      kind: 'directory',
      name: 'assets',
      path: 'assets',
      source: 'local',
    });
  });
});
