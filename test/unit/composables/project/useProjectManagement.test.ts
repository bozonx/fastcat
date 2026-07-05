/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, ref, nextTick } from 'vue';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import { useRouter } from '#app/composables/router';

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

const { mockReadLocalStorageString, mockWriteLocalStorageString, mockOpenDialog, mockInvokeTauri } =
  vi.hoisted(() => ({
    mockReadLocalStorageString: vi.fn().mockImplementation((key, fallback) => fallback),
    mockWriteLocalStorageString: vi.fn(),
    mockOpenDialog: vi.fn(),
    mockInvokeTauri: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  readLocalStorageString: mockReadLocalStorageString,
  writeLocalStorageString: mockWriteLocalStorageString,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mockOpenDialog,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvokeTauri,
}));

describe('useProjectManagement', () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    workspaceMock.projects = [];
    workspaceMock.recentProjects = [];
    workspaceMock.error = null;
    workspaceMock.isLoading = false;
    workspaceMock.workspaceProviderId = 'web';
    workspaceMock.userSettings.openLastProjectOnStart = false;

    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      afterEach: vi.fn(),
      beforeEach: vi.fn(),
      beforeResolve: vi.fn(),
    } as any);
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

    it('opens the newly created project even when startup auto-open is disabled', async () => {
      const { projectCreationSettings, createNewProject } = useProjectManagement();
      projectCreationSettings.value.name = 'NewProject';

      await createNewProject();

      expect(mockGoToCut).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/editor/NewProject');
    });

    it('closes the modal on success', async () => {
      const { projectCreationSettings, createNewProject, isCreateModalOpen } =
        useProjectManagement();
      projectCreationSettings.value.name = 'NewProject';
      isCreateModalOpen.value = true;

      await createNewProject();

      expect(isCreateModalOpen.value).toBe(false);
    });

    it('keeps the modal open on error', async () => {
      const { projectCreationSettings, createNewProject, isCreateModalOpen } =
        useProjectManagement();
      projectCreationSettings.value.name = 'NewProject';
      isCreateModalOpen.value = true;
      workspaceMock.error = 'Some error';

      await createNewProject();

      expect(isCreateModalOpen.value).toBe(true);
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

    it('has no error when name is unchanged, but rename is invalid', () => {
      const { startRename, renameValue, renameError, isRenameNameValid } = useProjectManagement();
      startRename('OldProject');
      renameValue.value = 'OldProject';
      expect(renameError.value).toBeNull();
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

    it('closes the modal on success', async () => {
      const { startRename, renameValue, renameProject, isRenameModalOpen } = useProjectManagement();
      startRename({ projectName: 'OldProject', projectId: 'old-1' });
      renameValue.value = 'NewProject';
      isRenameModalOpen.value = true;

      await renameProject();

      expect(isRenameModalOpen.value).toBe(false);
    });

    it('keeps the modal open on error', async () => {
      const { startRename, renameValue, renameProject, isRenameModalOpen } = useProjectManagement();
      startRename({ projectName: 'OldProject', projectId: 'old-1' });
      renameValue.value = 'NewProject';
      isRenameModalOpen.value = true;
      workspaceMock.error = 'Some error';

      await renameProject();

      expect(isRenameModalOpen.value).toBe(true);
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

    it('has no error when duplicate name equals source name, but duplicate is invalid', () => {
      const { startDuplicate, duplicateValue, duplicateError, isDuplicateNameValid } =
        useProjectManagement();
      startDuplicate('Source');
      duplicateValue.value = 'Source';
      expect(duplicateError.value).toBeNull();
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
        targetParentPath: undefined,
      });
    });

    it('closes the modal on success', async () => {
      const { startDuplicate, duplicateValue, confirmDuplicate, isDuplicateModalOpen } =
        useProjectManagement();
      startDuplicate({ projectName: 'Source', projectId: 'src-1' });
      duplicateValue.value = 'Copy';
      isDuplicateModalOpen.value = true;

      await confirmDuplicate();

      expect(isDuplicateModalOpen.value).toBe(false);
    });

    it('keeps the modal open on error', async () => {
      const { startDuplicate, duplicateValue, confirmDuplicate, isDuplicateModalOpen } =
        useProjectManagement();
      startDuplicate({ projectName: 'Source', projectId: 'src-1' });
      duplicateValue.value = 'Copy';
      isDuplicateModalOpen.value = true;
      workspaceMock.error = 'Some error';

      await confirmDuplicate();

      expect(isDuplicateModalOpen.value).toBe(true);
    });

    it('passes targetParentPath in Tauri mode', async () => {
      workspaceMock.workspaceProviderId = 'tauri';
      const { startDuplicate, duplicateValue, duplicateLocation, confirmDuplicate } =
        useProjectManagement();
      startDuplicate({
        projectName: 'Source',
        projectId: 'src-1',
        projectPath: '/projects/Source',
      });
      duplicateValue.value = 'Copy';
      duplicateLocation.value = '/custom/target';

      await confirmDuplicate();

      expect(workspaceMock.duplicateProject).toHaveBeenCalledWith({
        sourceName: 'Source',
        targetName: 'Copy',
        sourceProjectId: 'src-1',
        sourceProjectPath: '/projects/Source',
        targetParentPath: '/custom/target',
      });
    });
  });

  describe('startDuplicate', () => {
    it('sets duplicateLocation to source project parent directory', () => {
      const { startDuplicate, duplicateLocation } = useProjectManagement();
      startDuplicate({ projectName: 'Source', projectPath: '/projects/Source' });
      expect(duplicateLocation.value).toBe('/projects');
    });

    it('falls back to projectsRoot when projectPath is missing', () => {
      const { startDuplicate, duplicateLocation } = useProjectManagement();
      startDuplicate({ projectName: 'Source' });
      expect(duplicateLocation.value).toBe('/mock-projects');
    });
  });

  describe('closeDuplicateModal', () => {
    it('clears duplicateLocation', () => {
      const { startDuplicate, closeDuplicateModal, duplicateLocation } = useProjectManagement();
      startDuplicate({ projectName: 'Source', projectPath: '/projects/Source' });
      expect(duplicateLocation.value).toBe('/projects');
      closeDuplicateModal();
      expect(duplicateLocation.value).toBe('');
    });
  });

  describe('isExternalProject', () => {
    it('returns false for projects inside projectsRoot', () => {
      const { isExternalProject } = useProjectManagement();
      expect(isExternalProject('/mock-projects/MyProject')).toBe(false);
    });

    it('returns true for projects outside projectsRoot', () => {
      const { isExternalProject } = useProjectManagement();
      expect(isExternalProject('/other/path/Project')).toBe(true);
    });

    it('returns false for undefined projectPath', () => {
      const { isExternalProject } = useProjectManagement();
      expect(isExternalProject(undefined)).toBe(false);
    });
  });

  describe('handleOpenProject', () => {
    it('redirects to desktop editor path and resets view in desktop mode', () => {
      const { handleOpenProject } = useProjectManagement({ isMobile: false });
      handleOpenProject('MyProject');

      expect(mockGoToCut).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith('/editor/MyProject');
    });

    it('redirects to mobile editor path with default view edit when localStorage is empty', () => {
      mockReadLocalStorageString.mockReturnValueOnce(null);
      const { handleOpenProject } = useProjectManagement({ isMobile: true });
      handleOpenProject('MyProject');

      expect(mockGoToCut).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/m/editor/MyProject?view=edit');
    });

    it('redirects to mobile editor path with the view read from localStorage', () => {
      mockReadLocalStorageString.mockReturnValueOnce('files');
      const { handleOpenProject } = useProjectManagement({ isMobile: true });
      handleOpenProject('MyProject');

      expect(mockPush).toHaveBeenCalledWith('/m/editor/MyProject?view=files');
    });

    it('redirects to mobile editor path with view edit when localStorage value is invalid', () => {
      mockReadLocalStorageString.mockReturnValueOnce('export');
      const { handleOpenProject } = useProjectManagement({ isMobile: true });
      handleOpenProject('MyProject');

      expect(mockPush).toHaveBeenCalledWith('/m/editor/MyProject?view=edit');
    });
  });

  describe('startDelete and confirmDelete', () => {
    it('opens delete confirmation modal even when deleteWithoutConfirmation setting is enabled', async () => {
      workspaceMock.userSettings.deleteWithoutConfirmation = true;
      const { startDelete, isDeleteModalOpen, deleteTargetProject } = useProjectManagement();

      startDelete({ projectName: 'TestProj', projectId: 'id-1', projectPath: '/path/TestProj' });

      expect(isDeleteModalOpen.value).toBe(true);
      expect(deleteTargetProject.value).toEqual({
        projectName: 'TestProj',
        projectId: 'id-1',
        projectPath: '/path/TestProj',
      });
    });

    it('calls deleteProject and closes modal on confirm', async () => {
      const { startDelete, confirmDelete, isDeleteModalOpen } = useProjectManagement();

      startDelete({ projectName: 'TestProj', projectId: 'id-1', projectPath: '/path/TestProj' });
      expect(isDeleteModalOpen.value).toBe(true);

      await confirmDelete();

      expect(workspaceMock.deleteProject).toHaveBeenCalledWith({
        name: 'TestProj',
        projectId: 'id-1',
        projectPath: '/path/TestProj',
      });
      expect(isDeleteModalOpen.value).toBe(false);
    });
  });

  describe('startForget and confirmForget', () => {
    it('sets forget modal target and calls forgetProject on confirm', async () => {
      const { startForget, confirmForget, forgetTargetProject, isForgetModalOpen } =
        useProjectManagement();

      startForget({ projectName: 'ExtProj', projectId: 'id-ext', projectPath: '/ext/ExtProj' });
      expect(isForgetModalOpen.value).toBe(true);
      expect(forgetTargetProject.value).toEqual({
        projectName: 'ExtProj',
        projectId: 'id-ext',
        projectPath: '/ext/ExtProj',
      });

      await confirmForget();

      expect(workspaceMock.forgetProject).toHaveBeenCalledWith({
        name: 'ExtProj',
        projectId: 'id-ext',
        projectPath: '/ext/ExtProj',
      });
      expect(isForgetModalOpen.value).toBe(false);
    });
  });

  describe('Tauri dialog helpers', () => {
    it('selectProjectLocation opens directory picker and invokes allow_path_scope', async () => {
      mockOpenDialog.mockResolvedValueOnce('/custom/projects/dir');
      const { selectProjectLocation, projectCreationSettings } = useProjectManagement();

      await selectProjectLocation();

      expect(mockOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
      expect(mockInvokeTauri).toHaveBeenCalledWith('allow_path_scope', {
        path: '/custom/projects/dir',
      });
      expect(projectCreationSettings.value.location).toBe('/custom/projects/dir');
    });

    it('selectDuplicateLocation opens directory picker and updates location', async () => {
      mockOpenDialog.mockResolvedValueOnce('/custom/dup/dir');
      const { selectDuplicateLocation, duplicateLocation } = useProjectManagement();

      await selectDuplicateLocation();

      expect(mockOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
      expect(mockInvokeTauri).toHaveBeenCalledWith('allow_path_scope', {
        path: '/custom/dup/dir',
      });
      expect(duplicateLocation.value).toBe('/custom/dup/dir');
    });

    it('openProjectFromDisk opens directory picker and calls handleOpenProject', async () => {
      mockOpenDialog.mockResolvedValueOnce('/ext/projects/ExternalProject');
      const { openProjectFromDisk } = useProjectManagement();

      await openProjectFromDisk();

      expect(mockOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
      expect(mockPush).toHaveBeenCalledWith('/editor/%2Fext%2Fprojects%2FExternalProject');
    });
  });
});
