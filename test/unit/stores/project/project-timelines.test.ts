/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createProjectTimelinesModule } from '~/stores/project/project-timelines';
import type { FastCatProjectSettings } from '~/utils/project-settings';

function makeDefaultSettings(): FastCatProjectSettings {
  return {
    timelines: {
      openPaths: [],
      lastOpenedTimelinePath: null,
    },
  } as unknown as FastCatProjectSettings;
}

describe('createProjectTimelinesModule', () => {
  function setup(overrides?: Partial<{
    currentProjectName: string | null;
    currentTimelinePath: string | null;
    openPaths: string[];
    onActiveTimelineChanged: () => Promise<void> | void;
  }>) {
    const currentProjectName = ref(
      overrides && 'currentProjectName' in overrides
        ? overrides.currentProjectName!
        : 'test-project',
    );
    const currentTimelinePath = ref(overrides?.currentTimelinePath ?? null);
    const currentFileName = ref<string | null>(null);
    const projectSettings = ref(makeDefaultSettings());
    if (overrides?.openPaths) {
      projectSettings.value.timelines.openPaths = [...overrides.openPaths];
    }
    const saveProjectMeta = vi.fn().mockResolvedValue(undefined);
    const setWorkspaceError = vi.fn();
    const onActiveTimelineChanged = vi.fn(
      overrides?.onActiveTimelineChanged ?? (() => {}),
    );
    const toProjectRelativePath = vi.fn((path: string) => path);

    const mod = createProjectTimelinesModule({
      currentProjectName,
      currentTimelinePath,
      currentFileName,
      projectSettings,
      toProjectRelativePath,
      saveProjectMeta,
      setWorkspaceError,
      onActiveTimelineChanged,
    });

    return {
      mod,
      currentProjectName,
      currentTimelinePath,
      currentFileName,
      projectSettings,
      saveProjectMeta,
      setWorkspaceError,
      onActiveTimelineChanged,
    };
  }

  it('openTimelineFile sets error when no project is open', async () => {
    const { mod, setWorkspaceError } = setup({ currentProjectName: null });
    await mod.openTimelineFile('timelines/test.otio');
    expect(setWorkspaceError).toHaveBeenCalledWith('Project is not opened');
  });

  it('openTimelineFile ignores non-otio files', async () => {
    const { mod, currentTimelinePath } = setup();
    await mod.openTimelineFile('timelines/test.mp4');
    expect(currentTimelinePath.value).toBeNull();
  });

  it('openTimelineFile opens otio file and sets current path', async () => {
    const { mod, currentTimelinePath, currentFileName } = setup();
    await mod.openTimelineFile('timelines/test.otio');
    expect(currentTimelinePath.value).toBe('timelines/test.otio');
    expect(currentFileName.value).toBe('test.otio');
  });

  it('openTimelineFile adds to openPaths', async () => {
    const { mod, projectSettings } = setup();
    await mod.openTimelineFile('timelines/test.otio');
    expect(projectSettings.value.timelines.openPaths).toContain('timelines/test.otio');
  });

  it('openTimelineFile does not add duplicate to openPaths', async () => {
    const { mod, projectSettings } = setup({ openPaths: ['timelines/test.otio'] });
    await mod.openTimelineFile('timelines/test.otio');
    expect(projectSettings.value.timelines.openPaths).toHaveLength(1);
  });

  it('openTimelineFile does nothing when already active', async () => {
    const { mod, saveProjectMeta } = setup({ currentTimelinePath: 'timelines/test.otio' });
    await mod.openTimelineFile('timelines/test.otio');
    expect(saveProjectMeta).not.toHaveBeenCalled();
  });

  it('closeTimelineFile removes from openPaths', async () => {
    const { mod, projectSettings } = setup({ openPaths: ['timelines/a.otio', 'timelines/b.otio'] });
    await mod.closeTimelineFile('timelines/a.otio');
    expect(projectSettings.value.timelines.openPaths).toEqual(['timelines/b.otio']);
  });

  it('closeTimelineFile does nothing for unknown path', async () => {
    const { mod, projectSettings } = setup({ openPaths: ['timelines/a.otio'] });
    await mod.closeTimelineFile('timelines/unknown.otio');
    expect(projectSettings.value.timelines.openPaths).toEqual(['timelines/a.otio']);
  });

  it('closeTimelineFile switches to next tab when closing active', async () => {
    const { mod, currentTimelinePath, projectSettings } = setup({
      openPaths: ['timelines/a.otio', 'timelines/b.otio'],
      currentTimelinePath: 'timelines/a.otio',
    });
    await mod.closeTimelineFile('timelines/a.otio');
    expect(currentTimelinePath.value).toBe('timelines/b.otio');
  });

  it('closeTimelineFile clears current when closing last tab', async () => {
    const { mod, currentTimelinePath, currentFileName, onActiveTimelineChanged } = setup({
      openPaths: ['timelines/a.otio'],
      currentTimelinePath: 'timelines/a.otio',
    });
    await mod.closeTimelineFile('timelines/a.otio');
    expect(currentTimelinePath.value).toBeNull();
    expect(currentFileName.value).toBeNull();
    expect(onActiveTimelineChanged).toHaveBeenCalled();
  });

  it('closeOtherTimelineFiles keeps only the specified path', async () => {
    const { mod, projectSettings } = setup({
      openPaths: ['timelines/a.otio', 'timelines/b.otio', 'timelines/c.otio'],
    });
    await mod.closeOtherTimelineFiles('timelines/b.otio');
    expect(projectSettings.value.timelines.openPaths).toEqual(['timelines/b.otio']);
  });

  it('closeOtherTimelineFiles does nothing if path not in openPaths', async () => {
    const { mod, projectSettings } = setup({
      openPaths: ['timelines/a.otio'],
    });
    await mod.closeOtherTimelineFiles('timelines/unknown.otio');
    expect(projectSettings.value.timelines.openPaths).toEqual(['timelines/a.otio']);
  });

  it('closeAllTimelineFiles clears all paths', async () => {
    const { mod, projectSettings, currentTimelinePath, currentFileName, onActiveTimelineChanged } = setup({
      openPaths: ['timelines/a.otio', 'timelines/b.otio'],
      currentTimelinePath: 'timelines/a.otio',
    });
    await mod.closeAllTimelineFiles();
    expect(projectSettings.value.timelines.openPaths).toEqual([]);
    expect(currentTimelinePath.value).toBeNull();
    expect(currentFileName.value).toBeNull();
    expect(onActiveTimelineChanged).toHaveBeenCalled();
  });

  it('reorderTimelines updates openPaths order', () => {
    const { mod, projectSettings } = setup({
      openPaths: ['timelines/a.otio', 'timelines/b.otio'],
    });
    mod.reorderTimelines(['timelines/b.otio', 'timelines/a.otio']);
    expect(projectSettings.value.timelines.openPaths).toEqual(['timelines/b.otio', 'timelines/a.otio']);
  });
});
