/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';

const projectStore = {
  goToCut: vi.fn(),
  goToSound: vi.fn(),
  addTextPanel: vi.fn(),
  addMediaPanel: vi.fn(),
};

const uiStore = {
  pendingFsEntryCreateFolder: null as unknown,
  pendingFsEntryCreateTimeline: null as unknown,
  pendingFsEntryCreateMarkdown: null as unknown,
  pendingFsEntryRename: null as unknown,
  pendingFsEntryDelete: null as unknown,
};

const projectTabsStore = {
  addFileTab: vi.fn(() => 'tab-1'),
  setActiveTab: vi.fn(),
};

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/project-tabs.store', () => ({ useProjectTabsStore: () => projectTabsStore }));
vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn(() => 'video'),
  isOpenableProjectFileName: vi.fn(() => true),
}));

describe('useFilePropertiesHandlers', () => {
  beforeEach(() => {
    projectStore.goToCut.mockClear();
    projectStore.goToSound.mockClear();
    projectStore.addTextPanel.mockClear();
    projectStore.addMediaPanel.mockClear();
    projectTabsStore.addFileTab.mockClear();
    projectTabsStore.setActiveTab.mockClear();
    uiStore.pendingFsEntryCreateFolder = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryDelete = null;
  });

  it('disables open-as actions for external workspace/computer entries', () => {
    const api = useFilePropertiesHandlers({
      selectedFsEntry: ref({
        kind: 'file',
        name: 'clip.mp4',
        path: '/workspace/clip.mp4',
      }),
      mediaType: ref('video'),
      textContent: ref(null),
      isExternalContext: ref(true),
    });

    expect(api.canOpenAsPanel.value).toBe(false);
    expect(api.canOpenAsProjectTab.value).toBe(false);
  });

  it('keeps open-as actions for project file manager entries', () => {
    const api = useFilePropertiesHandlers({
      selectedFsEntry: ref({
        kind: 'file',
        name: 'clip.mp4',
        path: 'media/clip.mp4',
      }),
      mediaType: ref('video'),
      textContent: ref(null),
      isExternalContext: ref(false),
    });

    expect(api.canOpenAsPanel.value).toBe(true);
    expect(api.canOpenAsProjectTab.value).toBe(true);
  });

  it('treats absolute local paths as workspace/computer entries', () => {
    const api = useFilePropertiesHandlers({
      selectedFsEntry: ref({
        kind: 'file',
        name: 'clip.mp4',
        path: '/Users/demo/clip.mp4',
      }),
      mediaType: ref('video'),
      textContent: ref(null),
      isExternalContext: ref(false),
    });

    expect(api.canOpenAsPanel.value).toBe(false);
    expect(api.canOpenAsProjectTab.value).toBe(false);
  });
});
