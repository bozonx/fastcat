import { type Ref } from 'vue';

import {
  createProjectMetaRepository,
  type ProjectMetaRepository,
} from '~/repositories/project-meta.repository';

function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export interface ProjectMetaModule {
  loadProjectMeta: () => Promise<void>;
  clearProjectMetaState: () => void;
}

export function createProjectMetaModule(params: {
  currentProjectName: Ref<string | null>;
  currentProjectId: Ref<string | null>;
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
}) {
  const projectMetaRepo = { value: null as ProjectMetaRepository | null };

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
        params.currentProjectId.value = meta.id;
        return;
      }
    } catch {
      // ignore
    }

    const nextId = createProjectId();
    params.currentProjectId.value = nextId;

    try {
      await ensureRepo();
      await projectMetaRepo.value?.save({ id: nextId });
    } catch (e) {
      console.warn('Failed to write project meta file', e);
    }
  }

  function clearProjectMetaState() {
    projectMetaRepo.value = null;
  }

  const module: ProjectMetaModule = {
    loadProjectMeta,
    clearProjectMetaState,
  };

  return module;
}
