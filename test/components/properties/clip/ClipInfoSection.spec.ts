import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipInfoSection from '~/components/properties/clip/ClipInfoSection.vue';
import type { TimelineClipItem } from '~/timeline/types';

const FPS = 30;

const timelineStore = reactive<{
  timelineDoc: unknown;
  timelineFormat: { fps: number };
  fps: number;
}>({
  timelineDoc: { tracks: [], timebase: { fps: FPS } },
  timelineFormat: { fps: FPS },
  fps: FPS,
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));

function setDoc(trackKind: 'audio' | 'video', clip: TimelineClipItem) {
  timelineStore.timelineDoc = {
    timebase: { fps: FPS },
    tracks: [{ id: clip.trackId, kind: trackKind, name: 'T', items: [clip] }],
  };
}

function makeClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    source: { path: 'sound.wav' },
    sourceDurationTicks: 15_240_960_000_000,
    isImage: false,
    timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 762_048_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

const globalStubs = {
  PropertySection: { template: '<div class="prop-section"><slot /></div>' },
  PropertyRow: { template: '<div class="prop-row"></div>' },
  PropertyTimecode: { template: '<div class="prop-timecode"></div>' },
  PropertyDuration: { template: '<div class="prop-duration"></div>' },
  MediaMetadataList: { template: '<div class="media-meta"></div>' },
  UButton: {
    props: ['disabled', 'label', 'icon'],
    emits: ['click'],
    template:
      '<button class="snap-btn" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
};

async function mount(clip: TimelineClipItem) {
  return mountSuspended(ClipInfoSection, {
    props: { clip, mediaMeta: null },
    global: { stubs: globalStubs },
  });
}

describe('ClipInfoSection snap-to-grid button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an enabled snap button for a free (sub-frame) audio clip', async () => {
    const clip = makeClip({
      timelineRange: {
        startTicks: 509_810_112_000,
        durationTicks: 878_133_312_000,
      },
    });
    setDoc('audio', clip);

    const wrapper = await mount(clip);
    const btn = wrapper.find('.snap-btn');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('disables the snap button for a frame-aligned audio clip', async () => {
    const clip = makeClip({
      timelineRange: { startTicks: 0, durationTicks: 762_048_000_000 },
    });
    setDoc('audio', clip);

    const wrapper = await mount(clip);
    const btn = wrapper.find('.snap-btn');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('does not render the snap button for a video clip', async () => {
    const clip = makeClip({
      trackId: 'v1',
      timelineRange: {
        startTicks: 509_810_112_000,
        durationTicks: 878_133_312_000,
      },
    });
    setDoc('video', clip);

    const wrapper = await mount(clip);
    expect(wrapper.find('.snap-btn').exists()).toBe(false);
  });

  it('emits snapToGrid when the button is clicked', async () => {
    const clip = makeClip({
      timelineRange: {
        startTicks: 509_810_112_000,
        durationTicks: 878_133_312_000,
      },
    });
    setDoc('audio', clip);

    const wrapper = await mount(clip);
    await wrapper.find('.snap-btn').trigger('click');
    expect(wrapper.emitted('snapToGrid')).toBeTruthy();
  });
});
