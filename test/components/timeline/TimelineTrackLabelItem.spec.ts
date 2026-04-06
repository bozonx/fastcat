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
});
