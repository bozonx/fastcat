/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, reactive } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import { useEditorHotkeys, hasBlockingModalState } from '~/composables/editor/useEditorHotkeys';
import { useTimelineHotkeys } from '~/composables/editor/hotkeys/useTimelineHotkeys';
import { getActiveElement } from '~/utils/browser-api';
import { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import { pressedKeyCodes } from '~/utils/hotkeys/pressedKeys';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useClipboardStore } from '~/stores/clipboard.store';

const mockWorkspaceStore = {
  userSettings: reactive({
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
      frameSnapMode: 'frames',
      toolbarSnapMode: 'snap',
      toolbarDragMode: 'pseudo_overlap',
      toolbarDragModeEnabled: false,
    },
  }),
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
    useProjectStore().currentProjectName = 'Test project';
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

  it('restores the last main focus from a non-main panel in cut view', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('monitor');
    focusStore.setPanelFocus('project');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('monitor');
  });

  it('toggles monitor and timeline focus in sound view', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('sound');
    expect(focusStore.activePanelId).toBe('timeline');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    expect(focusStore.activePanelId).toBe('monitor');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    expect(focusStore.activePanelId).toBe('timeline');
  });

  it('restores timeline focus to timeline in non-files editor views', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('export');
    focusStore.setMainFocus('timeline');
    focusStore.setPanelFocus('exportForm');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('timeline');
  });

  it('toggles file manager focus on Tab when editor is in files view', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('files');
    expect(focusStore.activePanelId).toBe('timeline');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    expect(focusStore.activePanelId).toBe('dynamic:file-manager:main');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
    expect(focusStore.activePanelId).toBe('dynamic:file-manager:sidebar');
  });

  it('returns from files view properties to project file manager on Tab', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('files');
    focusStore.setPanelFocus('dynamic:properties:files-main');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('dynamic:file-manager:main');
  });

  it('returns from timeline to project file manager on Tab in files view', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('files');
    focusStore.setPanelFocus('timeline');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));

    expect(focusStore.activePanelId).toBe('dynamic:file-manager:main');
  });

  it('uses files view focus routing for custom general.focus bindings', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'general.focus': ['F'],
    };

    projectStore.setView('files');
    focusStore.setPanelFocus('dynamic:file-manager:main');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));

    expect(focusStore.activePanelId).toBe('dynamic:file-manager:sidebar');
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

  it('preserves native Tab navigation inside editable elements in files view', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('files');
    focusStore.setPanelFocus('dynamic:file-manager:main');

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
    expect(focusStore.activePanelId).toBe('dynamic:file-manager:main');

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

  it('leaves Escape to an editable element', async () => {
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

    expect(selectionStore.selectedEntity).not.toBeNull();
    expect(timelineStore.selectedItemIds).toEqual(['clip-1']);
    expect(timelineStore.selectedTrackId).toBe('track-1');

    input.remove();
  });

  it('selects every timeline item with Ctrl+A even when a track is selected', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    timelineStore.timelineDoc = {
      id: 'doc-1',
      tracks: [
        {
          id: 'track-1',
          items: [
            { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
            {
              id: 'gap-1',
              kind: 'gap',
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
            },
          ],
        },
        {
          id: 'track-2',
          items: [
            {
              id: 'clip-2',
              kind: 'clip',
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectTrack('track-1');

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(timelineStore.selectedTrackId).toBeNull();
    expect(timelineStore.selectedItemIds.sort()).toEqual(['clip-1', 'clip-2', 'gap-1']);
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

  it('leaves Escape in a modal to the modal system', async () => {
    wrapper = mount(HotkeysHarness);
    const selectionStore = useSelectionStore();
    const timelineStore = useTimelineStore() as any;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    selectionStore.selectTimelineMarker('marker-1');
    timelineStore.selectedItemIds = ['clip-1'];

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      dialog.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(selectionStore.selectedEntity).not.toBeNull();
      expect(timelineStore.selectedItemIds).toEqual(['clip-1']);
    } finally {
      dialog.remove();
    }
  });

  it('blocks files view Tab focus routing while modal state is active', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();

    projectStore.setView('files');
    focusStore.setPanelFocus('dynamic:file-manager:main');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);

    try {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }),
      );

      expect(focusStore.activePanelId).toBe('dynamic:file-manager:main');
    } finally {
      dialog.remove();
    }
  });

  it('routes preview speed commands before monitor group filtering', async () => {
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'playback.forward2': ['Digit2'],
    };
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const uiStore = useUiStore();

    focusStore.setPanelFocus('dynamic:properties:files-main');
    uiStore.hasActivePreviewPlayer = true;

    const event = new KeyboardEvent('keydown', {
      key: '2',
      code: 'Digit2',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(uiStore.previewPlaybackTrigger).toMatchObject({
      action: 'set',
      speed: 2,
      direction: 'forward',
    });
  });

  it('routes Space and Shift+Space to preview playback toggles', async () => {
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'playback.toggle1': ['Space'],
      'playback.toggle': ['Shift+Space'],
    };
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const uiStore = useUiStore();

    focusStore.setPanelFocus('project');
    uiStore.hasActivePreviewPlayer = true;

    const spaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(spaceEvent);

    expect(spaceEvent.defaultPrevented).toBe(true);
    expect(uiStore.previewPlaybackTrigger.action).toBe('toggle1');

    const shiftSpaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(shiftSpaceEvent);

    expect(shiftSpaceEvent.defaultPrevented).toBe(true);
    expect(uiStore.previewPlaybackTrigger.action).toBe('toggle');
  });

  it('blocks reverse and boundary commands while preview player is focused', async () => {
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'playback.backward2': ['Digit2'],
      'playback.jumpNextBoundary': ['KeyG'],
    };
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const timelineStore = useTimelineStore() as any;
    const uiStore = useUiStore();

    focusStore.setPanelFocus('dynamic:properties:files-main');
    uiStore.hasActivePreviewPlayer = true;
    timelineStore.jumpToNextClipBoundary = vi.fn();

    const reverseEvent = new KeyboardEvent('keydown', {
      key: '2',
      code: 'Digit2',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(reverseEvent);

    expect(reverseEvent.defaultPrevented).toBe(true);
    expect(uiStore.previewPlaybackTrigger.action).toBe('');

    const boundaryEvent = new KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(boundaryEvent);

    expect(boundaryEvent.defaultPrevented).toBe(true);
    expect(timelineStore.jumpToNextClipBoundary).not.toHaveBeenCalled();
    expect(uiStore.previewPlaybackTrigger.action).toBe('');
  });

  it('lets non-transport commands fall through while preview player is focused', async () => {
    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'general.copy': ['Ctrl+C'],
    };
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const uiStore = useUiStore();

    focusStore.setPanelFocus('dynamic:properties:files-main');
    uiStore.hasActivePreviewPlayer = true;

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(uiStore.previewPlaybackTrigger.action).toBe('');
  });

  it('uses the updated T / Shift+T / B timeline shortcuts when timeline hotkeys are active', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    const splitClipAtPlayheadSpy = vi.fn().mockResolvedValue(undefined);
    const splitAllClipsAtPlayheadSpy = vi.fn().mockResolvedValue(undefined);
    const toggleLockTrackSpy = vi.fn().mockResolvedValue(undefined);
    timelineStore.splitClipAtPlayhead = splitClipAtPlayheadSpy;
    timelineStore.splitAllClipsAtPlayhead = splitAllClipsAtPlayheadSpy;
    timelineStore.toggleLockTargetTrack = toggleLockTrackSpy;
    const batchApplyTimelineSpy = vi.fn();
    timelineStore.batchApplyTimeline = batchApplyTimelineSpy;
    timelineStore.selectedItemIds = ['clip-1'];
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          items: [{ id: 'clip-1', kind: 'clip', locked: false }],
        },
      ],
    };
    timelineStore.requestTimelineSave = vi.fn().mockResolvedValue(undefined);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
    expect(splitClipAtPlayheadSpy).toHaveBeenCalledOnce();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', shiftKey: true, bubbles: true }),
    );
    expect(splitAllClipsAtPlayheadSpy).toHaveBeenCalledOnce();
    expect(toggleLockTrackSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true }));
    expect(batchApplyTimelineSpy).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: { locked: true },
      },
    ]);
  });

  it('toggles waveform mode on multiple selected clips with shortcuts', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.toggleWaveformMode': ['Alt+W'],
    };

    const batchApplyTimelineSpy = vi.fn();
    timelineStore.batchApplyTimeline = batchApplyTimelineSpy;
    timelineStore.selectedItemIds = ['clip-1', 'clip-2'];
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'audio',
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              clipType: 'media',
              isImage: false,
              audioWaveformMode: 'half',
            },
            {
              id: 'clip-2',
              kind: 'clip',
              clipType: 'media',
              isImage: false,
              audioWaveformMode: 'half',
            },
          ],
        },
      ],
    };
    timelineStore.requestTimelineSave = vi.fn().mockResolvedValue(undefined);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true, bubbles: true }),
    );

    expect(batchApplyTimelineSpy).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: { audioWaveformMode: 'full' },
      },
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-2',
        properties: { audioWaveformMode: 'full' },
      },
    ]);
  });

  it('toggles show waveform on multiple selected clips with shortcuts', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.toggleShowWaveform': ['Alt+S'],
    };

    const batchApplyTimelineSpy = vi.fn();
    timelineStore.batchApplyTimeline = batchApplyTimelineSpy;
    timelineStore.selectedItemIds = ['clip-1', 'clip-2'];
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'audio',
          items: [
            { id: 'clip-1', kind: 'clip', clipType: 'media', isImage: false, showWaveform: true },
            { id: 'clip-2', kind: 'clip', clipType: 'media', isImage: false, showWaveform: true },
          ],
        },
      ],
    };
    timelineStore.requestTimelineSave = vi.fn().mockResolvedValue(undefined);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', code: 'KeyS', altKey: true, bubbles: true }),
    );

    expect(batchApplyTimelineSpy).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: { showWaveform: false },
      },
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-2',
        properties: { showWaveform: false },
      },
    ]);
  });

  it('switches the active project tab in cut view with the new general shortcuts', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const projectTabsStore = useProjectTabsStore();

    projectTabsStore.registerProjectTab({ id: 'files', label: 'Files', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'history', label: 'History', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'effects', label: 'Effects', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'library', label: 'Library', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'markers', label: 'Markers', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'backups', label: 'Backups', component: {} as any });
    projectTabsStore.initDefaultTab();

    projectStore.setView('cut');

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'J',
        code: 'KeyJ',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(projectTabsStore.activeTabId).toBe('history');
    expect(focusStore.activePanelId).toBe('project');
  });

  it('creates virtual clips at playhead with the new timeline shortcuts', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;
    const uiStore = useUiStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    const addTextClipSpy = vi.fn(() => []);
    const addBackgroundClipSpy = vi.fn(() => []);
    const addAdjustmentClipSpy = vi.fn(() => []);
    timelineStore.addTextClipAtPlayhead = addTextClipSpy;
    timelineStore.addBackgroundClipAtPlayhead = addBackgroundClipSpy;
    timelineStore.addAdjustmentClipAtPlayhead = addAdjustmentClipSpy;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', bubbles: true }));

    expect(addTextClipSpy).toHaveBeenCalledOnce();
    expect(addBackgroundClipSpy).toHaveBeenCalledOnce();
    expect(addAdjustmentClipSpy).toHaveBeenCalledOnce();
    expect(uiStore.isProjectSettingsOpen).toBe(false);
    expect(uiStore.isEditorSettingsOpen).toBe(false);
  });

  it('switches timeline snap and drag modes with the new shortcuts', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const settingsStore = useTimelineSettingsStore();

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    settingsStore.selectToolbarSnapMode('snap');
    settingsStore.selectToolbarDragMode('pseudo_overlap');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));
    expect(settingsStore.toolbarSnapMode).toBe('no_snap');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', bubbles: true }));
    expect(settingsStore.toolbarSnapMode).toBe('free_mode');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
    expect(settingsStore.toolbarSnapMode).toBe('snap');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: "'", code: 'Quote', bubbles: true }));
    expect(settingsStore.toolbarDragMode).toBe('slip');
    expect(settingsStore.toolbarDragModeEnabled).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: ';', code: 'Semicolon', bubbles: true }),
    );
    expect(settingsStore.toolbarDragMode).toBe('pseudo_overlap');
    expect(settingsStore.toolbarDragModeEnabled).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }));
    expect(settingsStore.toolbarDragModeEnabled).toBe(false);
  });

  it('does not switch project tabs outside cut view', async () => {
    wrapper = mount(HotkeysHarness);
    const projectStore = useProjectStore();
    const projectTabsStore = useProjectTabsStore();

    projectTabsStore.registerProjectTab({ id: 'files', label: 'Files', component: {} as any });
    projectTabsStore.registerProjectTab({ id: 'history', label: 'History', component: {} as any });
    projectTabsStore.initDefaultTab();

    projectStore.setView('files');

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'J',
        code: 'KeyJ',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(projectTabsStore.activeTabId).toBe('files');
  });

  it('opens background tasks and settings with the new general shortcuts', async () => {
    wrapper = mount(HotkeysHarness);
    const uiStore = useUiStore();
    const focusStore = useFocusStore();

    focusStore.setPanelFocus('project');

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Y',
        code: 'KeyY',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(uiStore.isBackgroundTasksOpen).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'U',
        code: 'KeyU',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(uiStore.isProjectSettingsOpen).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'I',
        code: 'KeyI',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(uiStore.isEditorSettingsOpen).toBe(true);
  });

  it('runs global ripple delete by selected clip bounds with Shift+Z', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.rippleDeleteSelectedClipRange': ['Shift+Z'],
      'timeline.rippleDelete': ['Backspace'],
    };
    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    const rippleDeleteSpy = vi.fn();
    timelineStore.rippleDeleteSelectedClipRangeAllTracks = rippleDeleteSpy;

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Z',
        code: 'KeyZ',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(rippleDeleteSpy).toHaveBeenCalledOnce();
  });

  it('prioritizes selected clip ripple delete over clearing an active selection range', async () => {
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');
    timelineStore.timelineDoc = {
      ...timelineStore.timelineDoc,
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              trackId: 'track-1',
              name: 'Clip 1',
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        },
      ],
    };
    timelineStore.selectTimelineItems(['clip-1']);
    timelineStore.updateSelectionRange({ startUs: 2_000_000, endUs: 3_000_000 });
    expect(timelineStore.selectedItemIds).toEqual(['clip-1']);
    expect(focusStore.canUseTimelineHotkeys).toBe(true);

    const handlers = useTimelineHotkeys(createHotkeyHoldRunner());
    const handled = handlers['timeline.rippleDelete']?.(
      new KeyboardEvent('keydown', { key: 'Z', code: 'KeyZ', shiftKey: true }),
    );

    expect(handled).toBe(true);
    expect(timelineStore.getSelectionRange()).toEqual({ startUs: 1_000_000, endUs: 2_000_000 });
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

  it('creates a folder in the current file-manager directory with Ctrl+\\', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const fileManagerStore = useFileManagerStore();
    const uiStore = useUiStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:file-manager:detached-files');
    fileManagerStore.selectedFolder = {
      kind: 'directory',
      name: 'assets',
      path: 'media/assets',
      source: 'local',
    } as any;

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '\\',
        code: 'Backslash',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(uiStore.pendingFsEntryCreateFolder).toEqual({
      kind: 'directory',
      name: 'assets',
      path: 'media/assets',
      source: 'local',
    });
  });

  it('does not route bare arrow keys from file-manager focus to timeline playback hotkeys', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:file-manager:detached-files');

    const seekFramesSpy = vi.fn();
    const jumpPrevSpy = vi.fn();
    const jumpNextSpy = vi.fn();
    timelineStore.seekFrames = seekFramesSpy;
    timelineStore.jumpToPrevClipBoundary = jumpPrevSpy;
    timelineStore.jumpToNextClipBoundary = jumpNextSpy;

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        code: 'ArrowRight',
        bubbles: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        code: 'ArrowUp',
        bubbles: true,
      }),
    );

    expect(seekFramesSpy).not.toHaveBeenCalled();
    expect(jumpPrevSpy).not.toHaveBeenCalled();
    expect(jumpNextSpy).not.toHaveBeenCalled();
  });

  it('creates a folder in the current directory from file properties focus', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const fileManagerStore = useFileManagerStore();
    const selectionStore = useSelectionStore();
    const uiStore = useUiStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:properties:files-main');
    fileManagerStore.selectedFolder = {
      kind: 'directory',
      name: 'docs',
      path: 'docs',
      source: 'local',
    } as any;
    selectionStore.selectFsEntry(
      {
        kind: 'file',
        name: 'readme.md',
        path: 'docs/readme.md',
        parentPath: 'docs',
        source: 'local',
      } as any,
      'main',
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '\\',
        code: 'Backslash',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(uiStore.pendingFsEntryCreateFolder).toEqual({
      kind: 'directory',
      name: 'docs',
      path: 'docs',
      source: 'local',
    });
  });

  it('routes global zoom hotkeys to file-manager tile scale when file manager is focused', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const fileManagerStore = useFileManagerStore();

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:file-manager:detached-files');
    fileManagerStore.gridCardSize = 130 as any;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', bubbles: true }));
    expect(fileManagerStore.gridCardSize).toBe(160);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', bubbles: true }));
    expect(fileManagerStore.gridCardSize).toBe(130);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', bubbles: true }));
    expect(fileManagerStore.gridCardSize).toBe(80);
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

  it('toggles timeline playback with Space from any panel focus', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'playback.toggle': ['Space'],
    };

    projectStore.setView('cut');
    const togglePlaybackSpy = vi.fn();
    timelineStore.togglePlayback = togglePlaybackSpy;

    const previewLikePanels: string[] = [
      'properties',
      'files-sidebar',
      'files-main',
      'filesBrowser',
      'left',
      'right',
      'project',
      'dynamic:file-manager:detached-files',
      'dynamic:properties:files-main',
    ];

    for (const panelId of previewLikePanels) {
      focusStore.setPanelFocus(panelId as any);
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }),
      );
      expect(togglePlaybackSpy).toHaveBeenCalled();
      togglePlaybackSpy.mockClear();
    }
  });

  it('blurs button elements on pointerdown', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.activeElement).not.toBe(button);

    button.remove();
  });

  it('blurs input button elements on pointerdown', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const input = document.createElement('input');
    input.type = 'submit';
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.activeElement).not.toBe(input);

    input.remove();
  });

  it('does not execute save hotkeys in editable inputs', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    const saveTimelineSpy = vi.fn();
    timelineStore.saveTimeline = saveTimelineSpy;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(saveTimelineSpy).not.toHaveBeenCalled();
    input.remove();
  });

  it('blocks Shift+S save in editable inputs', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'general.save': ['Shift+S'],
    };

    projectStore.setView('cut');
    const saveTimelineSpy = vi.fn();
    timelineStore.saveTimeline = saveTimelineSpy;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(saveTimelineSpy).not.toHaveBeenCalled();
    input.remove();
  });

  it('allows timeline hotkeys (toggleDisableClip, toggleMuteClip) from properties focus', async () => {
    wrapper = mount(HotkeysHarness, { attachTo: document.body });
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.toggleDisableClip': ['W'],
      'timeline.toggleMuteClip': ['Q'],
    };

    projectStore.setView('cut');
    focusStore.setPanelFocus('dynamic:properties:files-main');

    // Set selection source as timeline so focusStore allows timeline hotkeys
    selectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clip',
      itemId: 'clip-1',
      trackId: 'track-1',
    };

    const toggleDisableSpy = vi.fn().mockResolvedValue(undefined);
    const toggleMuteSpy = vi.fn().mockResolvedValue(undefined);
    timelineStore.toggleDisableTargetClip = toggleDisableSpy;
    timelineStore.toggleMuteTargetClip = toggleMuteSpy;

    // Send W key (Disable)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
    expect(toggleDisableSpy).toHaveBeenCalledOnce();

    // Send Q key (Mute)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }));
    expect(toggleMuteSpy).toHaveBeenCalledOnce();
  });

  it('triggers timeline.globalToStart and timeline.globalToEnd commands on Home and End keys', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.globalToStart': ['Home'],
      'timeline.globalToEnd': ['End'],
    };

    projectStore.setView('cut');
    // Set focus to a preview-like panel (e.g. project files)
    focusStore.setPanelFocus('project');

    const goToStartSpy = vi.fn();
    const goToEndSpy = vi.fn();
    timelineStore.goToStart = goToStartSpy;
    timelineStore.goToEnd = goToEndSpy;

    // Send Home key
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', code: 'Home', bubbles: true }),
    );
    expect(goToStartSpy).toHaveBeenCalledOnce();

    // Send End key
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', bubbles: true }));
    expect(goToEndSpy).toHaveBeenCalledOnce();
  });

  it('groups and ungroups clips via Ctrl+G and Ctrl+Shift+G hotkeys', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const selectionStore = useSelectionStore();
    const timelineStore = useTimelineStore() as any;

    mockWorkspaceStore.userSettings.hotkeys.bindings = {
      'timeline.groupClips': ['Ctrl+G'],
      'timeline.ungroupClips': ['Ctrl+Shift+G'],
    };

    projectStore.setView('cut');
    focusStore.setMainFocus('timeline');

    selectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clips',
      items: [
        { trackId: 'track-1', itemId: 'clip-1' },
        { trackId: 'track-1', itemId: 'clip-2' },
      ],
    };

    const batchApplyTimelineSpy = vi.fn();
    timelineStore.batchApplyTimeline = batchApplyTimelineSpy;

    // Send Ctrl+G (Group)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true }),
    );
    expect(batchApplyTimelineSpy).toHaveBeenCalledOnce();
    expect(batchApplyTimelineSpy.mock.calls[0][0]).toEqual([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: { linkedGroupId: expect.any(String) },
      },
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-2',
        properties: { linkedGroupId: expect.any(String) },
      },
    ]);

    // Send Ctrl+Shift+G (Ungroup)
    batchApplyTimelineSpy.mockClear();
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'G',
        code: 'KeyG',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(batchApplyTimelineSpy).toHaveBeenCalledOnce();
    expect(batchApplyTimelineSpy.mock.calls[0][0]).toEqual([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: { linkedGroupId: undefined },
      },
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-2',
        properties: { linkedGroupId: undefined },
      },
    ]);
  });

  it('routes global zoom hotkeys to monitor zoom when a dynamic monitor panel is focused', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const uiStore = useUiStore();

    projectStore.setView('cut');
    // Dynamic monitor panel focus (e.g. monitor detached into a dock panel)
    focusStore.setPanelFocus('dynamic:monitor:detached');

    const monitorZoomSpy = vi.spyOn(uiStore, 'triggerMonitorZoom');
    const monitorZoomResetSpy = vi.spyOn(uiStore, 'triggerMonitorZoomReset');
    const monitorZoomFitSpy = vi.spyOn(uiStore, 'triggerMonitorZoomFit');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', bubbles: true }));
    expect(monitorZoomSpy).toHaveBeenCalledWith(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', bubbles: true }));
    expect(monitorZoomSpy).toHaveBeenCalledWith(-1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', bubbles: true }));
    expect(monitorZoomResetSpy).toHaveBeenCalledOnce();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '0', code: 'Digit0', shiftKey: true, bubbles: true }),
    );
    expect(monitorZoomFitSpy).toHaveBeenCalledOnce();
  });

  it('sets selection in/out points globally regardless of focused panel', async () => {
    wrapper = mount(HotkeysHarness);
    const focusStore = useFocusStore();
    const projectStore = useProjectStore();
    const timelineStore = useTimelineStore() as any;

    projectStore.setView('cut');
    timelineStore.currentTime = 1_000_000;
    const createSelectionRangeSpy = vi.fn();
    timelineStore.getSelectionRange = vi.fn(() => null);
    timelineStore.createSelectionRange = createSelectionRangeSpy;
    timelineStore.updateSelectionRange = vi.fn();

    // Focus an unrelated panel (e.g. properties) — I/O must still work.
    focusStore.setPanelFocus('properties');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', bubbles: true }));
    expect(createSelectionRangeSpy).toHaveBeenCalledOnce();

    createSelectionRangeSpy.mockClear();
    timelineStore.getSelectionRange = vi.fn(() => ({ startUs: 0, endUs: 2_000_000 }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }));
    expect(timelineStore.updateSelectionRange).toHaveBeenCalledOnce();
  });
});

describe('getActiveElement', () => {
  it('returns document.activeElement', () => {
    expect(getActiveElement()).toBe(document.activeElement);
  });
});

describe('hasBlockingModalState', () => {
  it('returns true when dialog is open', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);

    try {
      expect(hasBlockingModalState()).toBe(true);
    } finally {
      dialog.remove();
    }
  });

  it('returns true when role="dialog" exists', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'dialog');
    document.body.appendChild(div);

    try {
      expect(hasBlockingModalState()).toBe(true);
    } finally {
      div.remove();
    }
  });

  it('returns false when no modal elements exist', () => {
    expect(hasBlockingModalState()).toBe(false);
  });
});
