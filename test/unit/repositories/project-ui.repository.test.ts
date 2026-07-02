// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createProjectUiRepository } from '~/repositories/project-ui.repository';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

describe('project-ui.repository', () => {
  it('preserves project-wide monitor transparency settings', async () => {
    const repo = createProjectUiRepository({ vfs: new InMemoryFileSystemAdapter() });

    await repo.save({
      version: 1,
      monitor: {
        previewResolution: 0,
        useProxy: true,
        previewEffectsEnabled: true,
        showGrid: false,
        showTimecode: true,
        showTransparencyGrid: true,
        showMarkerTexts: false,
        toolbarPosition: 'bottom',
        previewBlurQuality: 'auto',
      },
      monitors: {},
      timelines: { openPaths: [], sessions: {} },
      ui: {
        activeTabId: null,
        fileTabs: [],
        staticTabsOrder: [],
        tabOrder: [],
        hiddenStaticTabs: [],
        fileManagerPaths: {},
        layout: {
          cutPanels: null,
          soundPanels: null,
          splitSizes: {},
          verticalSplitSizes: {},
          timelineHeights: {},
        },
      },
    });

    const loaded = await repo.load();

    expect(loaded?.monitor?.showTransparencyGrid).toBe(true);
    expect(loaded?.monitor?.showMarkerTexts).toBe(false);
  });
});
