import { createDevLogger } from '~/utils/dev-logger';
import { ref, type Ref } from 'vue';

import {
  createProjectMetaRepository,
  type ProjectMetaRepository,
  type ProjectMeta,
} from '~/repositories/project-meta.repository';
import { genUuid } from '~/utils/ids';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
const log = createDevLogger('project-meta');

function createProjectId(): string {
  return genUuid();
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
  getVfs: () => IFileSystemAdapter;
}) {
  const projectMetaRepo = { value: null as ProjectMetaRepository | null };
  const projectMeta = ref<ProjectMeta | null>(null);

  async function ensureRepo(): Promise<ProjectMetaRepository | null> {
    if (projectMetaRepo.value) return projectMetaRepo.value;
    // Default VFS route targets the active project; callers guard on
    // `currentProjectName` before reading/writing.
    projectMetaRepo.value = createProjectMetaRepository({ vfs: params.getVfs() });
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
    } catch (e) {
      // A genuine read failure (e.g. corrupt meta file) must be surfaced — we
      // still fall through to minting a fresh id so the project stays usable.
      log.warn('Failed to load project meta', e);
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
      log.warn('Failed to write project meta file', e);
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
      log.warn('Failed to save project meta', e);
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
