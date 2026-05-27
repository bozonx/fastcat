import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineTrackLabelItem from '~/components/timeline/TimelineTrackLabelItem.vue';

const mockTimelineStore = reactive({
  renamingTrackId: null as string | null,
  isAnyTrackSoloed: false,
  toggleVideoHidden: vi.fn(),
  toggleTrackAudioMuted: vi.fn(),
  toggleTrackAudioSolo: vi.fn(),
  updateTrackProperties: vi.fn(),
  selectAllClipsOnTrack: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

describe('TimelineTrackLabelItem', () => {
  const baseProps = {
    track: {
      id: 'track-1',
      name: 'Audio 1',
      kind: 'audio',
      locked: false,
      audioMuted: false,
      audioSolo: false,
      color: '#2a2a2a',
      items: [],
    },
    height: 64,
    isSelected: false,
    isDirectlySelected: false,
    isHovered: false,
    isRenaming: false,
    hasAudio: true,
    trackNumber: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockTimelineStore.renamingTrackId = null;
    mockTimelineStore.isAnyTrackSoloed = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps clip indicator active until the deadline after repeated clipping updates', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        levelDb: -6,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    const clipIndicator = () => component.find('button[type="button"]');

    expect(clipIndicator().attributes('title')).toBe('');

    await component.setProps({ levelDb: 1 });
    await component.vm.$nextTick();
    expect(clipIndicator().attributes('title')).toContain('Clipped!');

    vi.advanceTimersByTime(1000);
    await component.setProps({ levelDb: 2 });
    await component.vm.$nextTick();

    vi.advanceTimersByTime(1000);
    await component.vm.$nextTick();
    expect(clipIndicator().attributes('title')).toContain('Clipped!');

    vi.advanceTimersByTime(450);
    await component.vm.$nextTick();
    expect(clipIndicator().attributes('title')).toBe('');
  });

  it('resets clip indicator immediately on click', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        levelDb: -6,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    await component.setProps({ levelDb: 1 });
    await component.vm.$nextTick();

    const clipIndicator = component.find('button[type="button"]');
    expect(clipIndicator.attributes('title')).toContain('Clipped!');

    await clipIndicator.trigger('click');

    expect(component.find('button[type="button"]').attributes('title')).toBe('');
  });

  it('emits request-rename when trying to rename while selected', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        isSelected: true,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    const nameSpan = component.find('.cursor-pointer span');
    await nameSpan.trigger('click');

    expect(component.emitted('request-rename')).toBeTruthy();
  });

  it('emits select when trying to rename while not selected', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        isSelected: false,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    const nameSpan = component.find('.cursor-pointer span');
    await nameSpan.trigger('click');

    expect(component.emitted('select')).toBeTruthy();
    expect(component.emitted('request-rename')).toBeFalsy();
  });

  it('renders input in small height when isRenaming is true', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        height: 40,
        isRenaming: true,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    expect(component.find('input').exists()).toBe(true);
    expect(component.find('textarea').exists()).toBe(false);
  });

  it('renders textarea in tall height when isRenaming is true', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        height: 64,
        isRenaming: true,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    expect(component.find('input').exists()).toBe(false);
    expect(component.find('textarea').exists()).toBe(true);
  });

  it('emits rename with trimmed value when input is blurred', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        height: 40,
        isRenaming: true,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    const input = component.find('input');
    await input.setValue('   New Track Name   ');
    await input.trigger('blur');

    expect(component.emitted('rename')).toBeTruthy();
    expect(component.emitted('rename')?.[0]).toEqual(['New Track Name']);
  });

  it('emits cancelRename when input is blurred with unchanged name', async () => {
    const component = await mountSuspended(TimelineTrackLabelItem, {
      props: {
        ...baseProps,
        height: 40,
        isRenaming: true,
      },
      global: {
        stubs: {
          UiToggleButton: { template: '<div class="toggle-stub"></div>' },
        },
      },
    });

    const input = component.find('input');
    await input.setValue('Audio 1');
    await input.trigger('blur');

    expect(component.emitted('cancelRename')).toBeTruthy();
    expect(component.emitted('rename')).toBeFalsy();
  });
});
