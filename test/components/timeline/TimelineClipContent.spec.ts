import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineClipContent from '~/components/timeline/TimelineClipContent.vue';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: {
      ui: {
        clipThumbnailMode: 'all',
      },
    },
  }),
}));

vi.mock('~/components/timeline/TimelineClipThumbnails.vue', () => ({
  default: { name: 'TimelineClipThumbnails', template: '<div class="clip-thumbnails"></div>' },
}));
vi.mock('~/components/timeline/audio/TimelineAudioWaveform.vue', () => ({
  default: { name: 'TimelineAudioWaveform', template: '<div class="audio-waveform"></div>' },
}));
vi.mock('~/components/timeline/TimelineClipPreviewOverlays.vue', () => ({
  default: {
    name: 'TimelineClipPreviewOverlays',
    template: '<div class="preview-overlays"></div>',
  },
}));

const defaultTrack = {
  id: 'track-1',
  kind: 'video',
  items: [],
};

const defaultClipItem = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  clipType: 'media',
  name: 'Sample Clip Video.mp4',
  timelineRange: { startUs: 0, durationUs: 5000000 },
  sourceRange: { startUs: 0, durationUs: 5000000 },
};

const defaultProps = {
  item: defaultClipItem,
  track: defaultTrack,
  clipItem: defaultClipItem,
  effectiveClipItem: defaultClipItem,
  effectiveTimelineStartUs: 0,
  isHeaderOnly: false,
  clipWidthPx: 200,
  zoom: 1,
  scrollLeft: 0,
  viewportWidth: 1000,
  mediaMetadata: {},
  slipOverlay: null,
  trimOverlay: null,
  transitionInOverlayGuideStyle: null,
  transitionOutOverlayGuideStyle: null,
};

describe('TimelineClipContent', () => {
  it('renders top clip header with clip name in high-contrast badge', async () => {
    const wrapper = await mountSuspended(TimelineClipContent, {
      props: defaultProps as any,
    });

    const header = wrapper.find('span.truncate');
    expect(header.exists()).toBe(true);
    expect(header.text()).toBe('Sample Clip Video.mp4');
  });

  it('toggles keyframe block when keyframe button is clicked', async () => {
    const wrapper = await mountSuspended(TimelineClipContent, {
      props: defaultProps as any,
    });

    // Keyframe block initially collapsed
    expect(wrapper.text()).not.toContain('keyframesLane');

    // Click keyframes button
    const keyframesBtn = wrapper.find('button[title]');
    expect(keyframesBtn.exists()).toBe(true);
    await keyframesBtn.trigger('click');

    // Keyframe block now visible
    expect(wrapper.text()).toContain('keyframesLane');

    // Toggle off
    await keyframesBtn.trigger('click');
    expect(wrapper.text()).not.toContain('keyframesLane');
  });

  it('collapses to header-only: hides content band, keyframes button and lane', async () => {
    const wrapper = await mountSuspended(TimelineClipContent, {
      props: { ...defaultProps, isHeaderOnly: true, keyframesExpanded: true } as any,
    });

    // Header + name still present
    expect(wrapper.find('span.truncate').text()).toBe('Sample Clip Video.mp4');
    // No content band (thumbnails) and no keyframes toggle/lane in header-only mode
    expect(wrapper.find('.clip-thumbnails').exists()).toBe(false);
    expect(wrapper.find('button[title]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('keyframesLane');
  });
});
