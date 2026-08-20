import { describe, it, expect, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTimelineSettingsDrawer from '~/components/timeline/MobileTimelineSettingsDrawer.vue';

const mockProjectStore = reactive({
  currentTimelinePath: '/project/Timeline.otio',
});

const mockFileManager = reactive({
  findEntryByPath: vi.fn(() => null),
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

const globalOptions = {
  stubs: {
    MobileTimelineDrawer: {
      props: ['open', 'activeSnapPoint'],
      emits: ['update:open', 'update:activeSnapPoint'],
      template: '<div class="drawer"><slot /></div>',
    },
    TimelineProperties: {
      props: {
        fsEntry: Object,
        isMobile: Boolean,
      },
      template: '<div class="timeline-properties">Properties</div>',
    },
  },
};

describe('MobileTimelineSettingsDrawer', () => {
  it('renders the drawer and properties', async () => {
    const wrapper = await mountSuspended(MobileTimelineSettingsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.find('.drawer').exists()).toBe(true);
    expect(wrapper.find('.timeline-properties').exists()).toBe(true);
  });

  it('passes the timeline file entry when no real entry is found', async () => {
    const wrapper = await mountSuspended(MobileTimelineSettingsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const properties = wrapper.findComponent(globalOptions.stubs.TimelineProperties);
    expect(properties.props('fsEntry')).toMatchObject({
      name: 'Timeline.otio',
      path: '/project/Timeline.otio',
      kind: 'file',
    });
    expect(properties.props('isMobile')).toBe(true);
  });

  it('passes the real timeline entry when found', async () => {
    const realEntry = { name: 'Real.otio', path: '/project/Real.otio', kind: 'file' };
    mockFileManager.findEntryByPath.mockReturnValue(realEntry as any);

    const wrapper = await mountSuspended(MobileTimelineSettingsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const properties = wrapper.findComponent(globalOptions.stubs.TimelineProperties);
    expect(properties.props('fsEntry')).toEqual(realEntry);
  });
});
