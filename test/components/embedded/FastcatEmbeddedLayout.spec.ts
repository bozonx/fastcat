import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';

const openProjectMock = vi.fn();
const loadTimelineMock = vi.fn();

const workspaceStoreMock = reactive({
  isEphemeral: false,
  workspaceHandle: {} as FileSystemDirectoryHandle | null,
  projects: [] as string[],
  isLoading: false,
  initAutomaticWorkspace: vi.fn(),
  wipeWorkspace: vi.fn(),
});

const projectStoreMock = reactive({
  currentProjectName: null as string | null,
  currentTimelinePath: null as string | null,
  createProject: vi.fn(),
  getProjectFileHandleByRelativePath: vi.fn(),
});

const timelineStoreMock = reactive({
  timelineDoc: null as { tracks: Array<{ items: unknown[] }> } | null,
  ensureTimelineDoc: vi.fn(),
  addClipToTimelineFromPath: vi.fn(),
});

const mediaStoreMock = reactive({
  getOrFetchMetadataByPath: vi.fn(),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStoreMock,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mediaStoreMock,
}));

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    openProject: openProjectMock,
    loadTimeline: loadTimelineMock,
  }),
}));

vi.mock('~/utils/external-assets.service', () => ({
  loadExternalAssets: vi.fn().mockResolvedValue([]),
}));

import FastcatEmbeddedLayout from '~/components/embedded/FastcatEmbeddedLayout.vue';

describe('FastcatEmbeddedLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    workspaceStoreMock.isEphemeral = false;
    workspaceStoreMock.workspaceHandle = {} as FileSystemDirectoryHandle;
    workspaceStoreMock.projects = [];
    workspaceStoreMock.isLoading = false;

    projectStoreMock.currentProjectName = null;
    projectStoreMock.currentTimelinePath = null;
    projectStoreMock.createProject.mockImplementation(async (name: string) => {
      projectStoreMock.currentProjectName = name;
      projectStoreMock.currentTimelinePath = 'timelines/embedded_project_001.otio';
    });

    timelineStoreMock.timelineDoc = null;
  });

  it('opens an existing embedded project through project actions', async () => {
    workspaceStoreMock.projects = ['embedded_project'];

    const wrapper = await mountSuspended(FastcatEmbeddedLayout, {
      global: {
        stubs: {
          MobileMonitorContainer: true,
          MobileTimeline: true,
          ExportForm: true,
          UiMobileDrawer: true,
          UIcon: true,
        },
      },
    });

    expect(openProjectMock).toHaveBeenCalledWith('embedded_project');
    expect(loadTimelineMock).not.toHaveBeenCalled();

    await wrapper.unmount();
  });

  it('loads the initial timeline after creating an embedded project', async () => {
    const wrapper = await mountSuspended(FastcatEmbeddedLayout, {
      global: {
        stubs: {
          MobileMonitorContainer: true,
          MobileTimeline: true,
          ExportForm: true,
          UiMobileDrawer: true,
          UIcon: true,
        },
      },
    });

    expect(projectStoreMock.createProject).toHaveBeenCalledWith('embedded_project');
    expect(loadTimelineMock).toHaveBeenCalledWith('timelines/embedded_project_001.otio');

    await wrapper.unmount();
  });
});
