import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ResolutionSettings from '~/components/project-settings/ResolutionSettings.vue';
import { reactive } from 'vue';

const mockProjectStore = reactive({
  projectSettings: {
    project: {
      width: 1920,
      height: 1080,
      fps: 30,
      resolutionFormat: '16:9',
      orientation: 'landscape',
      aspectRatio: 1.7777777777777777,
      isCustomResolution: false,
      sampleRate: 48000,
      isAutoSettings: true,
    },
  },
});

const mockWorkspaceStore = reactive({
  userSettings: {
    projectPresets: {
      selectedPresetId: '1080p',
      items: [
        {
          id: '1080p',
          name: 'Full HD 1080p',
          width: 1920,
          height: 1080,
          fps: 30,
          resolutionFormat: '16:9',
          orientation: 'landscape',
          aspectRatio: 1.7777777777777777,
          isCustomResolution: false,
          sampleRate: 48000,
        },
        {
          id: '4k',
          name: 'Ultra HD 4K',
          width: 3840,
          height: 2160,
          fps: 60,
          resolutionFormat: '16:9',
          orientation: 'landscape',
          aspectRatio: 1.7777777777777777,
          isCustomResolution: false,
          sampleRate: 48000,
        },
      ],
    },
  },
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: {
    name: 'UiFormSectionHeader',
    props: ['title'],
    template: '<div class="form-section-header">{{ title }}<slot /></div>',
  },
}));

vi.mock('~/components/ui/UiTooltip.vue', () => ({
  default: {
    name: 'UiTooltip',
    props: ['text'],
    template: '<div class="ui-tooltip" :data-tooltip="text"><slot /></div>',
  },
}));

vi.mock('~/components/media/MediaResolutionSettings.vue', () => ({
  default: {
    name: 'MediaResolutionSettings',
    props: ['width', 'height', 'fps'],
    template:
      '<div class="resolution-inputs">Inputs: {{ width }}x{{ height }} at {{ fps }}FPS</div>',
  },
}));

describe('ResolutionSettings.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.projectSettings.project.width = 1920;
    mockProjectStore.projectSettings.project.height = 1080;
    mockProjectStore.projectSettings.project.fps = 30;
    mockWorkspaceStore.userSettings.projectPresets.selectedPresetId = '1080p';
  });

  it('renders form section header with resolution title and tooltip', async () => {
    const component = await mountWithNuxt(ResolutionSettings);

    expect(component.exists()).toBe(true);
    expect(component.find('.form-section-header').exists()).toBe(true);
    expect(component.find('.form-section-header').text()).toContain(
      'videoEditor.projectSettings.resolutionAndFps',
    );
    const tooltip = component.find('.ui-tooltip');
    expect(tooltip.exists()).toBe(true);
    expect(tooltip.attributes('data-tooltip')).toBe(
      'videoEditor.projectSettings.resolutionAndFpsTooltip',
    );
  });

  it('renders MediaResolutionSettings with current project values', async () => {
    const component = await mountWithNuxt(ResolutionSettings);

    const resolutionInputs = component.find('.resolution-inputs');
    expect(resolutionInputs.exists()).toBe(true);
    expect(resolutionInputs.text()).toContain('1920x1080');
    expect(resolutionInputs.text()).toContain('30');
  });
});
