import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import { reactive } from 'vue';

const mockTimelineStore = {
  historyDebounce: {
    clearPendingDebouncedHistory: vi.fn(),
  },
  applyRestoredSnapshot: vi.fn(),
};

const mockHistoryStore = reactive({
  past: [] as any[],
  future: [] as any[],
  canUndo: vi.fn(() => false),
  canRedo: vi.fn(() => false),
  undoGlobal: vi.fn(),
  redoGlobal: vi.fn(),
});

const mockRestoreHistory = vi.fn();

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/history.store', () => ({
  useHistoryStore: () => mockHistoryStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    restoreHistory: mockRestoreHistory,
  }),
}));

describe('ProjectHistory.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHistoryStore.past = [];
    mockHistoryStore.future = [];
    mockHistoryStore.canUndo.mockReturnValue(false);
    mockHistoryStore.canRedo.mockReturnValue(false);
  });

  it('renders empty state when history is empty', async () => {
    const component = await mountWithNuxt(ProjectHistory);

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('videoEditor.fileManager.history.empty');
  });

  it('renders history entries when they exist', async () => {
    mockHistoryStore.past = [
      {
        id: '1',
        scope: 'timeline',
        snapshot: {},
        labelKey: 'videoEditor.fileManager.history.entries.addClip',
        timestamp: Date.now() - 1000,
      },
      {
        id: '2',
        scope: 'timeline',
        snapshot: {},
        labelKey: 'videoEditor.fileManager.history.entries.moveItem',
        timestamp: Date.now(),
      },
    ];
    mockHistoryStore.future = [
      {
        id: '3',
        scope: 'timeline',
        snapshot: {},
        labelKey: 'videoEditor.fileManager.history.entries.deleteItems',
        timestamp: Date.now() + 1000,
      },
    ];

    const component = await mountWithNuxt(ProjectHistory);

    // Should render the entries
    expect(component.text()).toContain('videoEditor.fileManager.history.entries.addClip');
    expect(component.text()).toContain('videoEditor.fileManager.history.entries.moveItem');
    expect(component.text()).toContain('videoEditor.fileManager.history.entries.deleteItems');
  });

  it('calls handleUndo on Undo button click', async () => {
    mockHistoryStore.canUndo.mockReturnValue(true);
    mockHistoryStore.undoGlobal.mockReturnValue({
      id: '1',
      scope: 'timeline',
      snapshot: { mock: 'snapshot' },
    });

    const component = await mountWithNuxt(ProjectHistory);

    // Locate the undo button (the first button in the actions container)
    const undoButton = component.findAll('button')[0];
    await undoButton.trigger('click');

    expect(mockTimelineStore.historyDebounce.clearPendingDebouncedHistory).toHaveBeenCalled();
    expect(mockHistoryStore.undoGlobal).toHaveBeenCalled();
    expect(mockTimelineStore.applyRestoredSnapshot).toHaveBeenCalledWith({ mock: 'snapshot' });
  });

  it('calls handleRedo on Redo button click', async () => {
    mockHistoryStore.canRedo.mockReturnValue(true);
    mockHistoryStore.redoGlobal.mockReturnValue({
      id: '3',
      scope: 'fileManager',
      snapshot: { mock: 'fileSnapshot' },
    });

    const component = await mountWithNuxt(ProjectHistory);

    // Locate the redo button (the second button in the actions container)
    const redoButton = component.findAll('button')[1];
    await redoButton.trigger('click');

    expect(mockTimelineStore.historyDebounce.clearPendingDebouncedHistory).toHaveBeenCalled();
    expect(mockHistoryStore.redoGlobal).toHaveBeenCalled();
    expect(mockRestoreHistory).toHaveBeenCalledWith({ mock: 'fileSnapshot' });
  });
});
