// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { createDefaultProjectSettings } from '~/utils/project-settings';
import { createDefaultUserSettings } from '~/utils/settings/helpers';

describe('project-settings.repository', () => {
  it('returns null on missing file', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createProjectSettingsRepository({ vfs });

    expect(await repo.load()).toBeNull();
  });

  it('saves technical settings without monitors or timelines', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createProjectSettingsRepository({ vfs });

    const data = createDefaultProjectSettings(createDefaultUserSettings());
    await repo.save(data);

    const raw = await repo.load();
    expect(raw).toBeTruthy();
    expect((raw as any).project.width).toBe(data.project.width);
    expect((raw as any).monitors).toBeUndefined();
    expect((raw as any).timelines).toBeUndefined();
    expect((raw as any).ui).toBeUndefined();
    expect((raw as any).timeline).toBeUndefined();
  });

  it('writes to the named project path when projectPath is set', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const repo = createProjectSettingsRepository({ vfs, projectPath: '@project/Demo' });

    const data = createDefaultProjectSettings(createDefaultUserSettings());
    await repo.save(data);

    // The same VFS, addressed via the explicit project path, must surface it.
    expect(await vfs.exists('@project/Demo/.fastcat/project.settings.json')).toBe(true);
  });
});
