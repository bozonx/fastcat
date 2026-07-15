// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { createProjectMetaRepository } from '~/repositories/project-meta.repository';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import { createWorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';
import {
  createDefaultTimelineDocument,
  parseTimelineFromOtio,
  serializeTimelineToOtio,
} from '~/timeline/otio-serializer';
import { createDefaultProjectSettings } from '~/utils/project-settings';
import { createDefaultUserSettings, createDefaultWorkspaceSettings } from '~/utils/settings';
import { TICKS_PER_SECOND } from '~/utils/time';
import { createDefaultWorkspaceState } from '~/utils/workspace-state';

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

function setTauriRuntime(enabled: boolean): void {
  if (enabled) {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    return;
  }
  delete (globalThis as TauriGlobal).__TAURI_INTERNALS__;
}

describe('workspace/project storage contracts', () => {
  afterEach(() => {
    setTauriRuntime(false);
  });

  it('reopens a web workspace project through fresh repositories and VFS reads', async () => {
    setTauriRuntime(false);
    const vfs = new InMemoryFileSystemAdapter();
    const userSettings = createDefaultUserSettings();
    const workspaceSettings = createDefaultWorkspaceSettings();
    const workspaceState = createDefaultWorkspaceState();
    const timeline = createDefaultTimelineDocument({
      id: 'timeline-main',
      name: 'Main',
      format: userSettings.projectDefaults,
    });
    timeline.metadata!.fastcat!.markers = [
      {
        id: 'marker-intro',
        name: 'Intro',
        timeUs: TICKS_PER_SECOND,
        color: 'blue',
      },
    ];

    await createWorkspaceSettingsRepository({ vfs }).saveUserSettings(userSettings);
    await createWorkspaceSettingsRepository({ vfs }).saveWorkspaceSettings(workspaceSettings);
    await createWorkspaceSettingsRepository({ vfs }).saveWorkspaceState({
      ...workspaceState,
      ui: {
        ...workspaceState.ui,
        lastProjectName: 'Demo',
        recentProjects: [{ projectName: 'Demo', projectId: 'project-1', updatedAt: '2026-06-30' }],
      },
    });
    await createProjectMetaRepository({ vfs, projectPath: '@project/Demo' }).save({
      id: 'project-1',
      title: 'Demo',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });
    await createProjectSettingsRepository({ vfs, projectPath: '@project/Demo' }).save(
      createDefaultProjectSettings(userSettings),
    );
    await vfs.writeFile('@project/Demo/timelines/main.otio', serializeTimelineToOtio(timeline));

    const reopenedWorkspaceRepo = createWorkspaceSettingsRepository({ vfs });
    const reopenedProjectMetaRepo = createProjectMetaRepository({
      vfs,
      projectPath: '@project/Demo',
    });
    const reopenedProjectSettingsRepo = createProjectSettingsRepository({
      vfs,
      projectPath: '@project/Demo',
    });
    const reopenedTimelineText = await (
      await vfs.readFile('@project/Demo/timelines/main.otio')
    ).text();
    const reopenedTimeline = parseTimelineFromOtio(
      reopenedTimelineText,
      {
        id: 'fallback',
        name: 'Fallback',
        format: userSettings.projectDefaults,
      },
      { logWarnings: false },
    );

    expect(await vfs.exists('@workspace/.fastcat-config/user.settings.json')).toBe(true);
    expect(await vfs.exists('@workspace/.fastcat-config/app.settings.json')).toBe(true);
    expect(await vfs.exists('@workspace/.fastcat-config/workspace-state.json')).toBe(true);
    expect(await reopenedWorkspaceRepo.loadWorkspaceState()).toMatchObject({
      ui: { lastProjectName: 'Demo' },
    });
    expect(await reopenedProjectMetaRepo.load()).toMatchObject({
      id: 'project-1',
      title: 'Demo',
    });
    expect(await reopenedProjectSettingsRepo.load()).toMatchObject({
      project: { width: userSettings.projectDefaults.width },
    });
    expect(reopenedTimeline).toMatchObject({
      id: 'timeline-main',
      name: 'Main',
      metadata: {
        fastcat: {
          markers: [expect.objectContaining({ id: 'marker-intro', timeUs: TICKS_PER_SECOND })],
        },
      },
    });
  });

  it('keeps Tauri global settings separate from workspace/project data', async () => {
    setTauriRuntime(true);
    const vfs = new InMemoryFileSystemAdapter();
    const userSettings = createDefaultUserSettings();
    const workspaceSettings = createDefaultWorkspaceSettings();
    const repo = createWorkspaceSettingsRepository({ vfs });

    await repo.saveUserSettings(userSettings);
    await repo.saveAppSettings({
      ui: { locale: 'en-US', theme: 'dark' },
      storage: { mode: 'system' },
      integrations: {
        bloggerDog: { enabled: false },
        fastcatAccount: { enabled: false },
        stt: { enabled: false, models: [] },
      },
    } as never);
    await repo.saveWorkspaceSettings(workspaceSettings);
    await repo.saveWorkspaceState(createDefaultWorkspaceState());
    await createProjectMetaRepository({ vfs, projectPath: '@project/DesktopDemo' }).save({
      id: 'project-desktop',
      title: 'Desktop Demo',
    });

    expect(await vfs.exists('@config/user.settings.json')).toBe(true);
    expect(await vfs.exists('@config/app.settings.json')).toBe(true);
    expect(await vfs.exists('/vardata/app.settings.json')).toBe(true);
    expect(await vfs.exists('/vardata/workspace-state.json')).toBe(true);
    expect(await vfs.exists('@project/DesktopDemo/.fastcat/project.meta.json')).toBe(true);
    expect(await repo.loadAppSettings()).toMatchObject({ storage: { mode: 'system' } });
    expect(await repo.loadWorkspaceSettings()).toMatchObject({
      paths: { placementMode: workspaceSettings.paths.placementMode },
    });
  });
});
