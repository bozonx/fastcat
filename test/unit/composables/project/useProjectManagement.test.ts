/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, ref, nextTick } from 'vue';
import { useProjectManagement } from '~/composables/project/useProjectManagement';

const mockCreateProject = vi.fn().mockResolvedValue(undefined);
const mockGoToCut = vi.fn();

const workspaceMock = reactive({
  projectsHandle: null,
  projects: [] as string[],
  recentProjects: [] as { projectName: string; projectId?: string; projectPath?: string }[],
  error: null as string | null,
  isLoading: false,
  workspaceProviderId: 'web',
  resolvedStorageTopology: {
    projectsRoot: '/mock-projects',
    tempRoot: '/mock-temp',
    proxiesRoot: '/mock-proxies',
    ephemeralTmpRoot: '/mock-ephemeral-tmp',
    commonRoot: '/mock-common',
    dataRoot: '/mock-data',
  },
  userSettings: {
    openLastProjectOnStart: false,
  },
  renameProject: vi.fn().mockResolvedValue(undefined),
  duplicateProject: vi.fn().mockResolvedValue(undefined),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  forgetProject: vi.fn().mockResolvedValue(undefined),
  loadProjects: vi.fn().mockResolvedValue(undefined),
});

const projectMock = {
  createProject: mockCreateProject,
  goToCut: mockGoToCut,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceMock),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => projectMock),
}));

describe('useProjectManagement', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    workspaceMock.projects = [];
    workspaceMock.recentProjects = [];
    workspaceMock.error = null;
    workspaceMock.isLoading = false;
    workspaceMock.workspaceProviderId = 'web';
    workspaceMock.userSettings.openLastProjectOnStart = false;
  });

  it('initializes with closed modals and empty form values', () => {
    const {
      isCreateModalOpen,
      isRenameModalOpen,
      isDuplicateModalOpen,
      projectCreationSettings,
      renameValue,
      duplicateValue,
    } = useProjectManagement();

    expect(isCreateModalOpen.value).toBe(false);
    expect(isRenameModalOpen.value).toBe(false);
    expect(isDuplicateModalOpen.value).toBe(false);
    expect(projectCreationSettings.value.name).toBe('');
    expect(renameValue.value).toBe('');
    expect(duplicateValue.value).toBe('');
  });

  describe('create validation', () => {
    it('reports nameRequired for empty project name', () => {
      const { projectCreationSettings, createError, isCreateNameValid } = useProjectManagement();
      projectCreationSettings.value.name = '   ';
      expect(createError.value).toBe('fastcat.projects.nameRequired');
      expect(isCreateNameValid.value).toBe(false);
    });

    it('reports nameInvalid for project name with forbidden characters', () => {
      const { projectCreationSettings, createError, isCreateNameValid } = useProjectManagement();
      projectCreationSettings.value.name = 'foo:bar';
      expect(createError.value).toBe('fastcat.projects.nameInvalid');
      expect(isCreateNameValid.value).toBe(false);
    });

    it('reports nameAlreadyExists when project name is taken', () => {
      workspaceMock.projects = ['Existing'];
      const { projectCreationSettings, createError, isCreateNameValid } = useProjectManagement();
      projectCreationSettings.value.name = 'Existing';
      expect(createError.value).toBe('fastcat.projects.nameAlreadyExists');
      expect(isCreateNameValid.value).toBe(false);
    });

    it('reports nameAlreadyExists when project name is in recentProjects', () => {
      workspaceMock.recentProjects = [{ projectName: 'Recent', projectId: 'recent-1' }];
      const { projectCreationSettings, createError } = useProjectManagement();
      projectCreationSettings.value.name = 'Recent';
      expect(createError.value).toBe('fastcat.projects.nameAlreadyExists');
    });

    it('has no error for valid unique project name', () => {
      workspaceMock.projects = ['Existing'];
      const { projectCreationSettings, createError, isCreateNameValid } = useProjectManagement();
      projectCreationSettings.value.name = 'NewProject';
      expect(createError.value).toBeNull();
      expect(isCreateNameValid.value).toBe(true);
    });
  });

  describe('createNewProject', () => {
    it('does not call projectStore.createProject when name is invalid', async () => {
      const { projectCreationSettings, createNewProject } = useProjectManagement();
      projectCreationSettings.value.name = 'Existing';
      workspaceMock.projects = ['Existing'];

      await createNewProject();

      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    it('calls projectStore.createProject with trimmed name and options when valid', async () => {
      const { projectCreationSettings, createNewProject } = useProjectManagement();
      projectCreationSettings.value.name = '  NewProject  ';

      await createNewProject();

      expect(mockCreateProject).toHaveBeenCalledTimes(1);
      expect(mockCreateProject).toHaveBeenCalledWith('NewProject', { parentPath: undefined });
    });
  });

  describe('rename validation', () => {
    it('reports nameRequired for empty rename value', () => {
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = '   ';
      expect(renameError.value).toBe('fastcat.projects.nameRequired');
      expect(isRenameNameValid.value).toBe(false);
    });

    it('reports nameInvalid for rename value with forbidden characters', () => {
      const { startRename, renameValue, renameError } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'foo<bar';
      expect(renameError.value).toBe('fastcat.projects.nameInvalid');
    });

    it('reports nameSameAsCurrent when name is unchanged', () => {
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'OldProject';
      expect(renameError.value).toBe('fastcat.projects.nameSameAsCurrent');
      expect(isRenameNameValid.value).toBe(false);
    });

    it('reports nameAlreadyExists when target name is taken by another project', () => {
      workspaceMock.projects = ['OldProject', 'Taken'];
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'Taken';
      expect(renameError.value).toBe('fastcat.projects.nameAlreadyExists');
      expect(isRenameNameValid.value).toBe(false);
    });

    it('allows renaming to the same case-insensitive name is not required here', () => {
      workspaceMock.projects = ['OldProject'];
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'OldProject';
      expect(renameError.value).toBe('fastcat.projects.nameSameAsCurrent');
      expect(isRenameNameValid.value).toBe(false);
    });

    it('has no error for valid different name', () => {
      workspaceMock.projects = ['OldProject'];
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'NewProject';
      expect(renameError.value).toBeNull();
      expect(isRenameNameValid.value).toBe(true);
    });
  });

  describe('renameProject', () => {
    it('does not call workspaceStore.renameProject when name is invalid', async () => {
      const { startRename, renameValue, renameProject } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = '   ';

      await renameProject();

      expect(workspaceMock.renameProject).not.toHaveBeenCalled();
    });

    it('calls workspaceStore.renameProject with trimmed new name when valid', async () => {
      const { startRename, renameValue, renameProject } = useProjectManagement();
      startRename({ projectName: 'OldProject', projectId: 'old-1' });
      renameValue.value = '  NewProject  ';

      await renameProject();

      expect(workspaceMock.renameProject).toHaveBeenCalledTimes(1);
      expect(workspaceMock.renameProject).toHaveBeenCalledWith({
        oldName: 'OldProject',
        newName: 'NewProject',
        projectId: 'old-1',
        projectPath: undefined,
      });
    });
  });

  describe('duplicate validation', () => {
    it('reports nameRequired for empty duplicate value', () => {
      const { startDuplicate, duplicateValue, duplicateError, isDuplicateNameValid } =
        useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = '   ';
      expect(duplicateError.value).toBe('fastcat.projects.nameRequired');
      expect(isDuplicateNameValid.value).toBe(false);
    });

    it('reports nameInvalid for duplicate value with forbidden characters', () => {
      const { startDuplicate, duplicateValue, duplicateError } = useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = 'foo/bar';
      expect(duplicateError.value).toBe('fastcat.projects.nameInvalid');
    });

    it('reports nameSameAsSource when duplicate name equals source name', () => {
      const { startDuplicate, duplicateValue, duplicateError, isDuplicateNameValid } =
        useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = 'Source';
      expect(duplicateError.value).toBe('fastcat.projects.nameSameAsSource');
      expect(isDuplicateNameValid.value).toBe(false);
    });

    it('reports nameAlreadyExists when duplicate name is taken', () => {
      workspaceMock.projects = ['Taken'];
      const { startDuplicate, duplicateValue, duplicateError, isDuplicateNameValid } =
        useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = 'Taken';
      expect(duplicateError.value).toBe('fastcat.projects.nameAlreadyExists');
      expect(isDuplicateNameValid.value).toBe(false);
    });

    it('has no error for valid unique duplicate name', () => {
      const { startDuplicate, duplicateValue, duplicateError, isDuplicateNameValid } =
        useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = 'Copy';
      expect(duplicateError.value).toBeNull();
      expect(isDuplicateNameValid.value).toBe(true);
    });
  });

  describe('confirmDuplicate', () => {
    it('does not call workspaceStore.duplicateProject when name is invalid', async () => {
      const { startDuplicate, duplicateValue, confirmDuplicate } = useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = '   ';

      await confirmDuplicate();

      expect(workspaceMock.duplicateProject).not.toHaveBeenCalled();
    });

    it('calls workspaceStore.duplicateProject with trimmed target name when valid', async () => {
      const { startDuplicate, duplicateValue, confirmDuplicate } = useProjectManagement();
      startDuplicate({ projectName: 'Source', projectId: 'src-1', projectPath: '/src' });
      duplicateValue.value = '  Copy  ';

      await confirmDuplicate();

      expect(workspaceMock.duplicateProject).toHaveBeenCalledTimes(1);
      expect(workspaceMock.duplicateProject).toHaveBeenCalledWith({
        sourceName: 'Source',
        targetName: 'Copy',
        sourceProjectId: 'src-1',
        sourceProjectPath: '/src',
      });
    });
  });
});
