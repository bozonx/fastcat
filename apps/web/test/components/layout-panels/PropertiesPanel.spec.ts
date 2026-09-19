import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';

import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import { useFocusStore } from '~/stores/focus.store';
import { setEmbedFeatures } from '~/utils/embed-features';

const embedRuntime = vi.hoisted(() => ({ active: false }));

vi.mock('~/utils/embed-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/utils/embed-runtime')>()),
  isEmbedRuntime: () => embedRuntime.active,
}));

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
    locale: ref('en-US'),
  })),
}));

vi.mock('~/components/properties/ClipProperties.vue', () => ({
  default: {
    name: 'ClipProperties',
    props: ['clip'],
    template: '<div data-testid="clip-properties" :data-disabled="clip.disabled"></div>',
  },
}));

vi.mock('~/components/properties/MultiMarkerProperties.vue', () => ({
  default: {
    name: 'MultiMarkerProperties',
    props: ['markerIds'],
    template: '<div data-testid="multi-marker-properties">{{ markerIds.join(",") }}</div>',
  },
}));

const timelineStore = reactive({
  timelineDoc: null,
  timelineFormat: { fps: 30 },
  markers: [],
  clearSelection: vi.fn(),
  selectTrack: vi.fn(),
});

const projectStore = reactive({
  currentTimelinePath: null as string | null,
});

const selectionStore = reactive({
  selectedEntity: null as any,
  clearSelection: vi.fn(),
});

const proxyStore = reactive({
  existingProxies: new Set<string>(),
});

const conversionStore = reactive({
  openConversionModal: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStore,
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => proxyStore,
}));

vi.mock('~/stores/file-conversion.store', () => ({
  useFileConversionStore: () => conversionStore,
}));

vi.mock('~/composables/file-conversion/useFileConversionStoreActions', () => ({
  useFileConversionStoreActions: () => ({
    openConversionModal: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    findEntryByPath: vi.fn(() => null),
    vfs: null,
    reloadDirectory: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/useComputerVfs', () => ({
  useComputerVfs: () => ({
    vfs: null,
    rootPath: ref(''),
    isTauri: false,
  }),
}));

vi.mock('~/composables/properties/usePropertiesPanelPendingActions', () => ({
  usePropertiesPanelPendingActions: () => ({
    isDeleteConfirmModalOpen: false,
    deleteTargets: [],
    handleDeleteConfirm: vi.fn(),
  }),
}));

describe('PropertiesPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    timelineStore.clearSelection.mockClear();
    timelineStore.selectTrack.mockClear();
    selectionStore.clearSelection.mockClear();
    conversionStore.openConversionModal.mockClear();
    selectionStore.selectedEntity = null;
    projectStore.currentTimelinePath = null;
    proxyStore.existingProxies.clear();
    embedRuntime.active = false;
    setEmbedFeatures(undefined);
  });

  it('uses the provided focus id for active state', async () => {
    const wrapper = await mountSuspended(PropertiesPanel, {
      props: {
        focusId: 'dynamic:properties:files-main',
      },
      global: {
        stubs: {
          UiButtonGroup: true,
          FileDeleteConfirmModal: true,
          TransitionProperties: true,
          MultiClipProperties: true,
          ClipProperties: true,
          GapProperties: true,
          TrackProperties: true,
          FileProperties: true,
          MultiFileProperties: true,
          MarkerProperties: true,
          MultiMarkerProperties: true,
          SelectionRangeProperties: true,
          TimelineProperties: true,
          ProjectEffectProperties: true,
          ProjectTransitionProperties: true,
          ProjectLibraryProperties: true,
          UIcon: true,
        },
      },
    });

    const focusStore = useFocusStore();
    focusStore.setPanelFocus('dynamic:properties:files-main');
    await nextTick();

    expect(wrapper.classes()).toContain('panel-focus-frame--active');
  });

  it('sets the provided focus id when an editable element receives focus', async () => {
    const wrapper = await mountSuspended(PropertiesPanel, {
      props: {
        focusId: 'dynamic:properties:files-main',
      },
      global: {
        stubs: {
          UiButtonGroup: true,
          FileDeleteConfirmModal: true,
          TransitionProperties: true,
          MultiClipProperties: true,
          ClipProperties: true,
          GapProperties: true,
          TrackProperties: true,
          FileProperties: true,
          MultiFileProperties: true,
          MarkerProperties: true,
          MultiMarkerProperties: true,
          SelectionRangeProperties: true,
          TimelineProperties: true,
          ProjectEffectProperties: true,
          ProjectTransitionProperties: true,
          ProjectLibraryProperties: true,
          UIcon: true,
        },
      },
      attachTo: document.body,
    });

    const focusStore = useFocusStore();
    const input = document.createElement('input');
    wrapper.element.appendChild(input);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(focusStore.activePanelId).toBe('dynamic:properties:files-main');

    wrapper.unmount();
  });

  it('shows group header title when selected clips form a single linked group', async () => {
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video' as const,
          items: [
            {
              id: 'clip-1',
              kind: 'clip' as const,
              linkedGroupId: 'group-abc',
              timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
            },
            {
              id: 'clip-2',
              kind: 'clip' as const,
              linkedGroupId: 'group-abc',
              timelineRange: { startTicks: 5_000_000, durationTicks: 5_000_000 },
            },
          ],
        },
      ],
    } as any;

    selectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clips',
      items: [
        { trackId: 'track-1', itemId: 'clip-1' },
        { trackId: 'track-1', itemId: 'clip-2' },
      ],
    };

    const wrapper = await mountSuspended(PropertiesPanel, {
      global: {
        stubs: {
          UiButtonGroup: true,
          FileDeleteConfirmModal: true,
          MultiClipProperties: true,
        },
      },
    });

    await nextTick();

    const headerTitle = wrapper.find('.ml-2.text-xs');
    expect(headerTitle.text()).toBe('fastcat.timeline.groupSelectedClipsCount');
  });

  it('shows multi-marker properties for marker multi-selection', async () => {
    selectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'markers',
      markerIds: ['m1', 'm2'],
    };

    const wrapper = await mountSuspended(PropertiesPanel, {
      global: {
        stubs: {
          UiButtonGroup: true,
          FileDeleteConfirmModal: true,
          UIcon: true,
        },
      },
    });

    await nextTick();

    expect(wrapper.find('[data-testid="multi-marker-properties"]').text()).toBe('m1,m2');
    expect(wrapper.find('.ml-2.text-xs').text()).toBe('fastcat.timeline.selectedMarkersCount');
  });

  it('updates clip prop reactively when timelineDoc clip properties change', async () => {
    const initialClip = {
      id: 'clip-1',
      kind: 'clip' as const,
      trackId: 'track-1',
      clipType: 'media' as const,
      name: 'Initial Clip',
      disabled: false,
      timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    };

    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video' as const,
          items: [initialClip],
        },
      ],
    } as any;

    selectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clip',
      itemId: 'clip-1',
      trackId: 'track-1',
    };

    const wrapper = await mountSuspended(PropertiesPanel, {
      global: {
        stubs: {
          UiButtonGroup: true,
          FileDeleteConfirmModal: true,
          UIcon: true,
          ClipProperties: {
            name: 'ClipProperties',
            props: ['clip'],
            template: '<div data-testid="clip-properties" :data-disabled="clip.disabled"></div>',
          },
        },
      },
    });

    await nextTick();

    const clipPropsEl = wrapper.find('[data-testid="clip-properties"]');
    expect(clipPropsEl.exists()).toBe(true);
    expect(clipPropsEl.attributes('data-disabled')).toBe('false');

    // Simulate timelineDoc update
    const updatedClip = { ...initialClip, disabled: true };
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video' as const,
          items: [updatedClip],
        },
      ],
    } as any;

    await nextTick();

    expect(clipPropsEl.attributes('data-disabled')).toBe('true');
  });

  describe('inside an embedded session without a media bin', () => {
    const stubs = {
      UiButtonGroup: true,
      FileDeleteConfirmModal: true,
      UIcon: true,
      FileProperties: { name: 'FileProperties', template: '<div data-testid="file-props" />' },
      TimelineProperties: {
        name: 'TimelineProperties',
        props: ['fsEntry'],
        template: '<div data-testid="timeline-props" :data-has-entry="!!fsEntry" />',
      },
    };

    it('shows the timeline instead of the workspace folder', async () => {
      embedRuntime.active = true;
      setEmbedFeatures(['export']);
      selectionStore.selectedEntity = {
        source: 'fileManager',
        kind: 'directory',
        entry: { name: 'session', path: '', kind: 'directory' },
      };

      const wrapper = await mountSuspended(PropertiesPanel, { global: { stubs } });

      expect(wrapper.find('[data-testid="file-props"]').exists()).toBe(false);
      const timeline = wrapper.find('[data-testid="timeline-props"]');
      expect(timeline.exists()).toBe(true);
      expect(timeline.attributes('data-has-entry')).toBe('false');
      expect(wrapper.find('.ml-2.text-xs').text()).toBe('fastcat.timeline.properties.title');
    });

    it('shows the timeline when nothing is selected', async () => {
      embedRuntime.active = true;
      setEmbedFeatures(['export']);

      const wrapper = await mountSuspended(PropertiesPanel, { global: { stubs } });

      expect(wrapper.find('[data-testid="timeline-props"]').exists()).toBe(true);
    });

    it('keeps file selections when the host switched the media bin on', async () => {
      embedRuntime.active = true;
      setEmbedFeatures(['export', 'files']);
      selectionStore.selectedEntity = {
        source: 'fileManager',
        kind: 'file',
        entry: { name: 'clip.mp4', path: 'video/clip.mp4', kind: 'file' },
      };

      const wrapper = await mountSuspended(PropertiesPanel, { global: { stubs } });

      expect(wrapper.find('[data-testid="file-props"]').exists()).toBe(true);
    });
  });
});
