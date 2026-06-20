import { describe, it, expect, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFilesView from '~/components/file-manager/MobileFilesView.vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

const globalOptions = {
  stubs: {
    MobileAssetBrowser: { template: '<div class="asset-browser" />' },
    MobileFileBrowser: { template: '<div class="file-browser" />' },
  },
};

function setExperimentalFeatures(enabled: boolean) {
  const workspaceStore = useWorkspaceStore();
  workspaceStore.userSettings.experimentalFeatures = enabled;
}

describe('MobileFilesView', () => {
  beforeEach(() => {
    setExperimentalFeatures(false);
  });

  it('shows the assets tab by default', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    expect(wrapper.find('.asset-browser').exists()).toBe(true);
    expect(wrapper.find('.file-browser').exists()).toBe(false);
  });

  it('renders only the assets tab when experimental features are disabled', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.find('button')!.attributes('aria-pressed')).toBe('true');
  });

  it('renders both tab switchers when experimental features are enabled', async () => {
    setExperimentalFeatures(true);
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    expect(wrapper.findAll('button')).toHaveLength(2);
  });

  it('marks the active tab via aria-pressed when experimental features are enabled', async () => {
    setExperimentalFeatures(true);
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });
    const [assetsTab, filesTab] = wrapper.findAll('button');

    expect(assetsTab!.attributes('aria-pressed')).toBe('true');
    expect(filesTab!.attributes('aria-pressed')).toBe('false');
  });

  it('switches to the files browser when the files tab is tapped', async () => {
    setExperimentalFeatures(true);
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    await wrapper.findAll('button')[1]!.trigger('click');

    expect(wrapper.find('.file-browser').exists()).toBe(true);
    expect(wrapper.find('.asset-browser').exists()).toBe(false);
  });

  it('switches back to assets after navigating to files', async () => {
    setExperimentalFeatures(true);
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    await wrapper.findAll('button')[1]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');

    expect(wrapper.find('.asset-browser').exists()).toBe(true);
    expect(wrapper.find('.file-browser').exists()).toBe(false);
  });

  it('hides the files tab and resets to assets when experimental features are disabled while files is active', async () => {
    setExperimentalFeatures(true);
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.find('.file-browser').exists()).toBe(true);

    setExperimentalFeatures(false);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.find('.asset-browser').exists()).toBe(true);
    expect(wrapper.find('.file-browser').exists()).toBe(false);
  });
});
