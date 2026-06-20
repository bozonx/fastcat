import { describe, it, expect, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';

const mockProjectStore = reactive({
  currentProjectName: 'Project A',
  projectSettings: { project: { width: 1920, height: 1080 } },
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

const globalOptions = {
  stubs: {
    UTabs: {
      props: ['modelValue', 'items'],
      emits: ['update:modelValue'],
      template:
        '<div class="tabs"><button v-for="item in items" :key="item.value" class="tab" :data-value="item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
    },
    ResolutionSettings: { template: '<div class="resolution-settings" />' },
    AdvancedSettings: { template: '<div class="advanced-settings" />' },
    MetadataSettings: { template: '<div class="metadata-settings" />' },
    StorageSettings: { template: '<div class="storage-settings" />' },
    ProjectBackups: { template: '<div class="project-backups" />' },
    SettingsSnap: { template: '<div class="settings-snap" />' },
    MobileAppSettingsPanel: { template: '<div class="app-settings-panel" />' },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileSettingsView', () => {
  it('starts on the app tab when no project is open', async () => {
    mockProjectStore.currentProjectName = '';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    expect(wrapper.find('.app-settings-panel').exists()).toBe(true);
  });

  it('starts on the project tab when a project is open', async () => {
    mockProjectStore.currentProjectName = 'Project A';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    expect(wrapper.find('.resolution-settings').exists()).toBe(true);
  });

  it('shows all project-related tabs when a project is open', async () => {
    mockProjectStore.currentProjectName = 'Project A';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    const tabs = wrapper.findAll('.tab');
    const values = tabs.map((t) => t.attributes('data-value'));
    expect(values).toContain('project');
    expect(values).toContain('snap');
    expect(values).toContain('backups');
    expect(values).toContain('app');
  });

  it('shows only the app tab when no project is open', async () => {
    mockProjectStore.currentProjectName = '';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    const values = wrapper.findAll('.tab').map((t) => t.attributes('data-value'));
    expect(values).toEqual(['app']);
  });

  it('switches to the snap tab when the tab is clicked', async () => {
    mockProjectStore.currentProjectName = 'Project A';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    await wrapper.find('[data-value="snap"]').trigger('click');
    expect(wrapper.find('.settings-snap').exists()).toBe(true);
  });

  it('switches to the app settings panel', async () => {
    mockProjectStore.currentProjectName = 'Project A';
    const wrapper = await mountSuspended(MobileSettingsView, { global: globalOptions });
    await wrapper.find('[data-value="app"]').trigger('click');
    expect(wrapper.find('.app-settings-panel').exists()).toBe(true);
  });
});
