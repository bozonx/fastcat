import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import VideoMonitor from '~/components/monitor/VideoMonitor.vue';

const MonitorContainerStub = {
  template: '<div class="monitor-container-stub" />',
};

describe('VideoMonitor', () => {
  it('renders MonitorContainer', async () => {
    const component = await mountSuspended(VideoMonitor, {
      global: { stubs: { MonitorContainer: MonitorContainerStub } },
    });

    expect(component.find('.monitor-container-stub').exists()).toBe(true);
  });
});
