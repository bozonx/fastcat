import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '../../../src/stores/project.store';
import { useWorkspaceStore } from '../../../src/stores/workspace.store';
import {
  createDefaultExportPresets,
  createDefaultProjectPresets,
} from '../../../src/utils/settings';

vi.mock('../../../src/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    projectsHandle: null,
    projects: [],
    error: null,
    userSettings: {
      projectDefaults: { audioDeclickDurationUs: 5000, defaultAudioFadeCurve: 'logarithmic' },
      projectPresets: createDefaultProjectPresets(),
      exportPresets: createDefaultExportPresets(),
      optimization: { proxyConcurrency: 2 },
    },
    loadProjects: vi.fn(),
  })),
}));

describe('ProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initializes with empty state', () => {
    const store = useProjectStore();
    expect(store.currentProjectName).toBeNull();
    expect(store.currentProjectId).toBeNull();
    expect(store.currentTimelinePath).toBeNull();
  });

  it('closeProject resets current project state and dependent stores', () => {
    const store = useProjectStore();
    store.currentProjectName = 'test-project';
    store.currentProjectId = '123';
    store.currentTimelinePath = '/some/path.otio';

    store.closeProject();

    expect(store.currentProjectName).toBeNull();
    expect(store.currentProjectId).toBeNull();
    expect(store.currentTimelinePath).toBeNull();
  });
});
