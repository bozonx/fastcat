import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ProjectBackups from '~/components/project/ProjectBackups.vue';
import { reactive, ref } from 'vue';

const mockTimelineStore = reactive({
  previewMode: false,
  currentTimelinePath: '/project/timeline.otio',
  isTimelineDirty: false,
  backupVersions: [] as any[],
  loadBackupVersions: vi.fn(),
  clearAllBackups: vi.fn(),
  getNextVersionName: vi.fn().mockResolvedValue('timeline__bak112.otio'),
  createVersionFromBackup: vi.fn(),
  openVersionForPreview: vi.fn(),
  deleteBackupVersion: vi.fn(),
});

const mockProjectStore = reactive({
  isReadOnly: false,
  listEntryNames: vi.fn().mockResolvedValue([]),
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('ProjectBackups.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.previewMode = false;
    mockTimelineStore.currentTimelinePath = '/project/timeline.otio';
    mockTimelineStore.isTimelineDirty = false;
    mockTimelineStore.backupVersions = [];
    mockProjectStore.isReadOnly = false;
  });

  it('renders empty state when backups are empty', async () => {
    const component = await mountWithNuxt(ProjectBackups);

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('videoEditor.timeline.backups.empty');
  });

  it('renders backups table and hides the title', async () => {
    mockTimelineStore.backupVersions = [
      {
        path: '/project/timeline.otio',
        name: 'timeline.otio',
        type: 'main',
        date: new Date('2026-06-11T23:03:00Z'),
        label: 'Main',
      },
      {
        path: '/project/timeline__bak111.otio',
        name: 'timeline__bak111.otio',
        type: 'backup',
        date: new Date('2026-06-12T10:01:00Z'),
        label: 'Backup #111',
      },
    ];

    const component = await mountWithNuxt(ProjectBackups);

    // Title should be gone
    expect(component.text()).not.toContain('videoEditor.timeline.backups.title');

    // Headers should be gone
    expect(component.text()).not.toContain('videoEditor.timeline.backups.version');
    expect(component.text()).not.toContain('videoEditor.timeline.backups.date');

    // Backup item names should be present
    expect(component.text()).toContain('timeline.otio');
    expect(component.text()).toContain('timeline__bak111.otio');

    // Main file badge should be rendered
    expect(component.text()).toContain('videoEditor.timeline.backups.mainFile');

    // Clear backups button with text should be rendered
    const clearButton = component.find('button');
    expect(clearButton.text()).toContain('videoEditor.timeline.backups.clearAllButton');
  });

  it('calls clearAllBackups on confirm clear backups', async () => {
    mockTimelineStore.backupVersions = [
      {
        path: '/project/timeline__bak111.otio',
        name: 'timeline__bak111.otio',
        type: 'backup',
        date: new Date('2026-06-12T10:01:00Z'),
        label: 'Backup #111',
      },
    ];

    const component = await mountWithNuxt(ProjectBackups);

    // Click clear all backups button
    const clearButton = component.findAll('button')[0];
    await clearButton.trigger('click');

    // Check modal opens or confirm is called
    // Since UiConfirmModal is stubbed or rendered, we can find the confirm trigger
    // Or we can call handleClearBackups directly, but let's test component state
    expect(component.vm.isClearBackupsConfirmOpen).toBe(true);

    // Simulate confirm event from modal
    await component.findComponent({ name: 'UiConfirmModal' }).vm.$emit('confirm');
    expect(mockTimelineStore.clearAllBackups).toHaveBeenCalled();
  });

  it('calls createVersionFromBackup on create version confirm', async () => {
    mockTimelineStore.backupVersions = [
      {
        path: '/project/timeline__bak111.otio',
        name: 'timeline__bak111.otio',
        type: 'backup',
        date: new Date('2026-06-12T10:01:00Z'),
        label: 'Backup #111',
      },
    ];

    const component = await mountWithNuxt(ProjectBackups);

    // Find camera button (Create Version)
    const createVerButton = component.find('button[icon="i-heroicons-camera"]');
    expect(createVerButton.exists()).toBe(true);

    await createVerButton.trigger('click');
    expect(component.vm.isCreateVersionModalOpen).toBe(true);

    // Simulate confirm event from UiEntityCreationModal
    await component.findComponent({ name: 'UiEntityCreationModal' }).vm.$emit('confirm', 'new_version.otio');
    expect(mockTimelineStore.createVersionFromBackup).toHaveBeenCalledWith(
      mockTimelineStore.backupVersions[0],
      'new_version.otio'
    );
  });
});
