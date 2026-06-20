import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFilesView from '~/components/file-manager/MobileFilesView.vue';

const globalOptions = {
  stubs: {
    MobileAssetBrowser: { template: '<div class="asset-browser" />' },
    MobileFileBrowser: { template: '<div class="file-browser" />' },
  },
};

describe('MobileFilesView', () => {
  it('shows the assets tab by default', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    expect(wrapper.find('.asset-browser').exists()).toBe(true);
    expect(wrapper.find('.file-browser').exists()).toBe(false);
  });

  it('renders both tab switchers', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });
    expect(wrapper.findAll('button')).toHaveLength(2);
  });

  it('marks the active tab via aria-pressed', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });
    const [assetsTab, filesTab] = wrapper.findAll('button');

    expect(assetsTab!.attributes('aria-pressed')).toBe('true');
    expect(filesTab!.attributes('aria-pressed')).toBe('false');
  });

  it('switches to the files browser when the files tab is tapped', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    await wrapper.findAll('button')[1]!.trigger('click');

    expect(wrapper.find('.file-browser').exists()).toBe(true);
    expect(wrapper.find('.asset-browser').exists()).toBe(false);
  });

  it('switches back to assets after navigating to files', async () => {
    const wrapper = await mountSuspended(MobileFilesView, { global: globalOptions });

    await wrapper.findAll('button')[1]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');

    expect(wrapper.find('.asset-browser').exists()).toBe(true);
    expect(wrapper.find('.file-browser').exists()).toBe(false);
  });
});
