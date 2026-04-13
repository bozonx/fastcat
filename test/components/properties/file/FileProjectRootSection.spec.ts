import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../../utils/mount';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import { useProjectSettingsStore } from '~/stores/project-settings.store';
import { useUiStore } from '~/stores/ui.store';

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: vi.fn(() => ({
    projectSettings: {
      project: {
        isCustomResolution: false,
        resolutionFormat: '1080p',
        width: 1920,
        height: 1080,
        fps: 25,
        sampleRate: 48000,
        orientation: 'landscape',
      },
      monitors: {
        cut: { orientation: 'landscape' },
      },
    },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-id',
    currentView: 'cut',
  })),
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: vi.fn(() => ({
    isProjectSettingsOpen: false,
  })),
}));

describe('FileProjectRootSection.vue', () => {
  it('renders project root parameters correctly', async () => {
    const component = await mountWithNuxt(FileProjectRootSection, {
      props: {
        isProjectRootDir: true,
        projectName: 'Test Project',
        storageFreeBytes: 1024 * 1024 * 1024 * 10,
        projectStats: {
          size: 1024 * 1024 * 500,
          fileCount: 42,
          dirCount: 5,
        },
      },
    });

    expect(component.text()).toContain('videoEditor.fileManager.projectRoot.title');
    expect(component.text()).toContain('500 MB');
    expect(component.text()).toContain('10 GB');
    expect(component.text()).toContain('1080p, 25FPS, 48kHz');
  });

  it('does not render if isProjectRootDir is false', async () => {
    const component = await mountWithNuxt(FileProjectRootSection, {
      props: {
        isProjectRootDir: false,
        projectName: 'Test Project',
        storageFreeBytes: null,
        projectStats: null,
      },
    });

    expect(component.html()).toBe('<!--v-if-->');
  });
});
