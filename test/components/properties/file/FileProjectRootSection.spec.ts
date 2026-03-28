import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../../utils/mount';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import { useProjectSettingsStore } from '~/stores/project-settings.store';
import { useUiStore } from '~/stores/ui.store';

describe('FileProjectRootSection.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders project root parameters correctly', async () => {
    const projectSettingsStore = useProjectSettingsStore();
    projectSettingsStore.projectSettings.project = {
      isCustomResolution: false,
      resolutionFormat: '1920x1080',
      width: 1920,
      height: 1080,
      fps: 30,
      sampleRate: 48000,
    } as any;

    const component = await mountWithNuxt(FileProjectRootSection, {
      props: {
        isProjectRootDir: true,
        projectName: 'Test Project',
        storageFreeBytes: 1024 * 1024 * 1024 * 10, // 10GB
        projectStats: {
          size: 1024 * 1024 * 500, // 500MB
          fileCount: 42,
          dirCount: 5,
        },
      },
    });

    // Check title
    expect(component.text()).toContain('Project root');

    // Check size
    expect(component.text()).toContain('500 MB');

    // Check free space
    expect(component.text()).toContain('10 GB');

    // Check parameters
    expect(component.text()).toContain('1920x1080, 30FPS, 48kHz');
  });

  it('opens project settings when clicking edit button', async () => {
    const uiStore = useUiStore();
    const component = await mountWithNuxt(FileProjectRootSection, {
      props: {
        isProjectRootDir: true,
        projectName: 'Test Project',
        storageFreeBytes: null,
        projectStats: null,
      },
    });

    const editBtn = component.find('button[title="Edit"]');
    await editBtn.trigger('click');
    expect(uiStore.isProjectSettingsOpen).toBe(true);
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
