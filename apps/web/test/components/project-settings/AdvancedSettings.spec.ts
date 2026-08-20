import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import AdvancedSettings from '~/components/project-settings/AdvancedSettings.vue';
import { reactive } from 'vue';

const mockProjectStore = reactive({
  projectSettings: {
    project: {
      audioDeclickDurationTicks: 5000,
    },
  },
});

const mockWorkspaceStore = reactive({
  userSettings: {
    projectDefaults: {
      audioDeclickDurationTicks: 5000,
    },
  },
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('AdvancedSettings.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.projectSettings.project.audioDeclickDurationTicks = 5000;
    mockWorkspaceStore.userSettings.projectDefaults.audioDeclickDurationTicks = 5000;
  });

  it('does not render reset button when project setting equals app default', async () => {
    const component = await mountWithNuxt(AdvancedSettings);

    expect(component.exists()).toBe(true);
    expect(component.find('[data-testid="form-field-reset"]').exists()).toBe(false);
  });

  it('renders reset button when project setting differs from app default', async () => {
    mockProjectStore.projectSettings.project.audioDeclickDurationTicks = 10000;
    const component = await mountWithNuxt(AdvancedSettings);

    expect(component.find('[data-testid="form-field-reset"]').exists()).toBe(true);
  });

  it('resets audioDeclickDurationTicks to app default when reset button is clicked', async () => {
    mockProjectStore.projectSettings.project.audioDeclickDurationTicks = 10000;
    const component = await mountWithNuxt(AdvancedSettings);

    const btn = component.find('[data-testid="form-field-reset"]');
    expect(btn.exists()).toBe(true);

    await btn.trigger('click');

    expect(mockProjectStore.projectSettings.project.audioDeclickDurationTicks).toBe(5000);
    expect(component.find('[data-testid="form-field-reset"]').exists()).toBe(false);
  });
});
