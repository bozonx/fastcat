/** @vitest-environment node */
import { computed, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';

const addFileTab = vi.fn(() => 'tab-1');
const setActiveTab = vi.fn();
const addTextPanel = vi.fn();
const addMediaPanel = vi.fn();
const goToCut = vi.fn();
const goToSound = vi.fn();

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    addTextPanel,
    addMediaPanel,
    goToCut,
    goToSound,
  }),
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    pendingFsEntryCreateFolder: null,
    pendingFsEntryCreateTimeline: null,
    pendingFsEntryCreateMarkdown: null,
    pendingFsEntryRename: null,
    pendingFsEntryDelete: null,
  }),
}));

vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: () => ({
    addFileTab,
    setActiveTab,
  }),
}));

describe('useFilePropertiesHandlers remote text file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows remote text files to open as panels and project tabs', () => {
    const selectedFsEntry = ref({
      kind: 'file',
      name: 'script.txt',
      path: '/personal/item-1/script.txt',
      source: 'remote',
    } as any);

    const handlers = useFilePropertiesHandlers({
      selectedFsEntry,
      mediaType: computed(() => 'text'),
      textContent: computed(() => ''),
    });

    expect(handlers.canOpenAsPanel.value).toBe(true);
    expect(handlers.canOpenAsProjectTab.value).toBe(true);

    handlers.openAsTextPanel('cut');
    handlers.openAsProjectTab();

    expect(addTextPanel).toHaveBeenCalledWith(
      '/personal/item-1/script.txt',
      'script.txt',
      undefined,
      undefined,
      'cut',
    );
    expect(addFileTab).toHaveBeenCalledWith({
      filePath: '/personal/item-1/script.txt',
      fileName: 'script.txt',
    });
    expect(setActiveTab).toHaveBeenCalledWith('tab-1');
  });
});
