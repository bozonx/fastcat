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

vi.mock('~/components/project-settings/SettingsSection.vue', () => ({
  default: {
    name: 'SettingsSection',
    props: ['title', 'summary'],
    template:
      '<div class="settings-section"><h2>{{ title }}</h2><p>{{ summary }}</p><slot /></div>',
  },
}));

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    name: 'UiSelect',
    props: ['modelValue', 'items', 'valueKey', 'labelKey'],
    template: `
      <select :value="modelValue" @change="$emit('update:modelValue', $event.target.value); $emit('update:model-value', $event.target.value)">
        <option v-for="item in items" :key="item[valueKey]" :value="item[valueKey]">
          {{ item[labelKey] }}
        </option>
      </select>
    `,
  },
}));

vi.mock('~/components/ui/UiFormField.vue', () => ({
  default: {
    name: 'UiFormField',
    props: ['label'],
    template: '<div class="form-field"><label>{{ label }}</label><slot /></div>',
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

  it('renders settings section with title and correct summary', async () => {
    const component = await mountWithNuxt(ResolutionSettings);

    expect(component.exists()).toBe(true);
    expect(component.find('.settings-section').exists()).toBe(true);
    expect(component.find('.settings-section h2').text()).toContain(
      'videoEditor.projectSettings.resolutionAndFps',
    );
    expect(component.find('.settings-section p').text()).toBe('1920x1080, 30FPS, 48kHz');
  });

  it('applies a new preset when selected in dropdown', async () => {
    const component = await mountWithNuxt(ResolutionSettings);

    const select = component.find('select');
    await select.setValue('4k');
    // setValue triggers change which emits update:modelValue
    await component.vm.$nextTick();

    expect(mockProjectStore.projectSettings.project.width).toBe(3840);
    expect(mockProjectStore.projectSettings.project.height).toBe(2160);
    expect(mockProjectStore.projectSettings.project.fps).toBe(60);
  });
});
