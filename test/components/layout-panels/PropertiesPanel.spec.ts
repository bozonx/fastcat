import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';

import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import { useFocusStore } from '~/stores/focus.store';

const timelineStore = reactive({
  timelineDoc: null,
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

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    findEntryByPath: vi.fn(() => null),
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
});
