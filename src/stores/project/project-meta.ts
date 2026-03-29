import { ref, type Ref } from 'vue';

import {
  createProjectMetaRepository,
  type ProjectMetaRepository,
  type ProjectMeta,
} from '~/repositories/project-meta.repository';

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export interface ProjectMetaModule {
  projectMeta: Ref<ProjectMeta | null>;
  loadProjectMeta: () => Promise<void>;
  saveProjectMeta: (updates: Partial<ProjectMeta>) => Promise<void>;
  clearProjectMetaState: () => void;
}

export function createProjectMetaModule(params: {
  currentProjectName: Ref<string | null>;
  currentProjectId: Ref<string | null>;
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  const projectMetaRepo = { value: null as ProjectMetaRepository | null };
  const projectMeta = ref<ProjectMeta | null>(null);

  async function ensureRepo(): Promise<ProjectMetaRepository | null> {
    if (projectMetaRepo.value) return projectMetaRepo.value;
    const dir = await params.getProjectDirHandle();
    projectMetaRepo.value = dir ? createProjectMetaRepository({ projectDir: dir }) : null;
    return projectMetaRepo.value;
  }

  async function loadProjectMeta() {
    if (!params.currentProjectName.value) return;

    try {
      await ensureRepo();

      const meta = await projectMetaRepo.value?.load();
      if (meta?.id) {
        projectMeta.value = meta;
        params.currentProjectId.value = meta.id;
        return;
      }
    } catch {
      // ignore
    }

    const nextId = createProjectId();
    const now = new Date().toISOString();
    const newMeta: ProjectMeta = {
      id: nextId,
      version: 1,
      title: params.currentProjectName.value || '',
      description: '',
      author: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    projectMeta.value = newMeta;
    params.currentProjectId.value = nextId;

    try {
      await ensureRepo();
      await projectMetaRepo.value?.save(newMeta);
    } catch (e) {
      console.warn('Failed to write project meta file', e);
    }
  }

  async function saveProjectMeta(updates: Partial<ProjectMeta>) {
    if (!projectMeta.value) return;

    const updatedMeta: ProjectMeta = {
      ...projectMeta.value,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    projectMeta.value = updatedMeta;

    try {
      await ensureRepo();
      await projectMetaRepo.value?.save(updatedMeta);
    } catch (e) {
      console.warn('Failed to save project meta', e);
    }
  }

  function clearProjectMetaState() {
    projectMetaRepo.value = null;
    projectMeta.value = null;
  }

  const module: ProjectMetaModule = {
    projectMeta,
    loadProjectMeta,
    saveProjectMeta,
    clearProjectMetaState,
  };

  return module;
}
