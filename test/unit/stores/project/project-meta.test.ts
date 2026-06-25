/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createProjectMetaModule } from '~/stores/project/project-meta';

vi.mock('~/repositories/project-meta.repository', () => ({
  createProjectMetaRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/utils/ids', () => ({
  genUuid: vi.fn(() => 'test-uuid-1234'),
}));

describe('createProjectMetaModule', () => {
  it('initializes with null projectMeta', () => {
    const currentProjectName = ref(null);
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    expect(mod.projectMeta.value).toBeNull();
  });

  it('loadProjectMeta does nothing when no project is open', async () => {
    const currentProjectName = ref(null);
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    await mod.loadProjectMeta();
    expect(mod.projectMeta.value).toBeNull();
  });

  it('loadProjectMeta creates new meta when none exists', async () => {
    const currentProjectName = ref('test-project');
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    await mod.loadProjectMeta();
    expect(mod.projectMeta.value).not.toBeNull();
    expect(mod.projectMeta.value!.id).toBe('test-uuid-1234');
    expect(mod.projectMeta.value!.title).toBe('test-project');
    expect(currentProjectId.value).toBe('test-uuid-1234');
  });

  it('clearProjectMetaState resets state', async () => {
    const currentProjectName = ref('test-project');
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    await mod.loadProjectMeta();
    expect(mod.projectMeta.value).not.toBeNull();
    mod.clearProjectMetaState();
    expect(mod.projectMeta.value).toBeNull();
  });

  it('saveProjectMeta does nothing when meta is null', async () => {
    const currentProjectName = ref(null);
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    await mod.saveProjectMeta({ title: 'updated' });
    expect(mod.projectMeta.value).toBeNull();
  });

  it('saveProjectMeta updates meta with partial updates', async () => {
    const currentProjectName = ref('test-project');
    const currentProjectId = ref(null);
    const mod = createProjectMetaModule({
      currentProjectName,
      currentProjectId,
      getVfs: () => ({} as any),
    });
    await mod.loadProjectMeta();
    await mod.saveProjectMeta({ title: 'updated-title', author: 'test-author' });
    expect(mod.projectMeta.value!.title).toBe('updated-title');
    expect(mod.projectMeta.value!.author).toBe('test-author');
    expect(mod.projectMeta.value!.updatedAt).toBeDefined();
  });
});
