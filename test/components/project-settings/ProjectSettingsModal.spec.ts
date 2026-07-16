import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mountWithNuxt } from '../../utils/mount';
import { reactive } from 'vue';

import ProjectSettingsModal from '~/components/project-settings/ProjectSettingsModal.vue';

mockNuxtImport('useI18n', () => {
  return () => ({
    t: (key: string) => key,
    locale: { value: 'en-US' },
  });
});

const mockProjectStore = reactive({
  currentProjectId: 'test-project-id',
  currentProjectName: 'My Awesome Video',
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
      audioDeclickDurationTicks: 1000,
    },
    exportDefaults: {
      encoding: {
        format: 'mp4',
        videoCodec: 'h264',
        bitrateMbps: 15,
        excludeAudio: false,
        audioCodec: 'aac',
        audioBitrateKbps: 192,
        bitrateMode: 'vbr',
        keyframeIntervalSec: 2,
        exportAlpha: false,
      },
    },
  },
  deleteCurrentProject: vi.fn(),
  saveProjectSettings: vi.fn(),
  saveProjectMeta: vi.fn(),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      defaultStaticClipDurationTicks: 5000000,
    },
    projectDefaults: {
      audioDeclickDurationTicks: 5000,
    },
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
      ],
    },
    exportPresets: {
      selectedPresetId: 'mp4-h264',
      items: [
        {
          id: 'mp4-h264',
          format: 'mp4',
          videoCodec: 'h264',
          bitrateMbps: 10,
          excludeAudio: false,
          audioCodec: 'aac',
          audioBitrateKbps: 128,
          bitrateMode: 'vbr',
          keyframeIntervalSec: 2,
          exportAlpha: false,
        },
      ],
    },
  },
  clearProjectVardata: vi.fn(),
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    name: 'UiModal',
    props: ['open', 'title'],
    template:
      '<div v-if="open" class="ui-modal-mock"><h3>{{ title }}</h3><slot /><slot name="footer" /></div>',
  },
}));

vi.mock('~/components/ui/UiConfirmModal.vue', () => ({
  default: {
    name: 'UiConfirmModal',
    props: ['open', 'title', 'description', 'confirmText'],
    template: `
      <div v-if="open" class="confirm-modal-mock">
        <h4>{{ title }}</h4>
        <button class="confirm-btn" @click="$emit('confirm')">{{ confirmText }}</button>
      </div>
    `,
  },
}));

vi.mock('~/components/project-settings/ResolutionSettings.vue', () => ({
  default: {
    name: 'ResolutionSettings',
    template: '<div class="resolution-settings-mock">Resolution Settings</div>',
  },
}));

vi.mock('~/components/project-settings/AdvancedSettings.vue', () => ({
  default: {
    name: 'AdvancedSettings',
    template: '<div class="advanced-settings-mock">Advanced Settings</div>',
  },
}));

vi.mock('~/components/project-settings/MetadataSettings.vue', () => ({
  default: {
    name: 'MetadataSettings',
    template: '<div class="metadata-settings-mock">Metadata Settings</div>',
  },
}));

vi.mock('~/components/project-settings/StorageSettings.vue', () => ({
  default: {
    name: 'StorageSettings',
    template: '<div class="storage-settings-mock">Storage Settings</div>',
  },
}));

vi.mock('~/components/ui/UiFormSectionHeader.vue', () => ({
  default: {
    name: 'UiFormSectionHeader',
    props: ['title'],
    template: '<div>Header: {{ title }}</div>',
  },
}));

describe('ProjectSettingsModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal with correct title and sections when open is true', async () => {
    const component = await mountWithNuxt(ProjectSettingsModal, {
      props: {
        open: true,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.ui-modal-mock').exists()).toBe(true);
    expect(component.find('.ui-modal-mock h3').text()).toContain('My Awesome Video');

    // Subsections should be rendered
    expect(component.find('.resolution-settings-mock').exists()).toBe(true);
    expect(component.find('.advanced-settings-mock').exists()).toBe(true);
    expect(component.find('.storage-settings-mock').exists()).toBe(true);
  });

  it('calls clearProjectVardata on confirmation', async () => {
    const component = await mountWithNuxt(ProjectSettingsModal, {
      props: {
        open: true,
      },
    });

    // Open clean cache confirmation
    component.vm.isClearProjectVardataConfirmOpen = true;
    await component.vm.$nextTick();

    const confirmBtn = component.find('.confirm-modal-mock .confirm-btn');
    await confirmBtn.trigger('click');

    expect(mockWorkspaceStore.clearProjectVardata).toHaveBeenCalledWith('test-project-id');
  });
});
