import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileAddToTimelineModal from '~/components/timeline/MobileAddToTimelineModal.vue';

const addTrackMock = vi.fn();
const addClipToTimelineFromPathMock = vi.fn();
const addTimelineClipToTimelineFromPathMock = vi.fn();
const requestTimelineSaveMock = vi.fn();

const videoTrack = { id: 'track-v', kind: 'video', name: 'Video 1', items: [] } as any;
const audioTrack = { id: 'track-a', kind: 'audio', name: 'Audio 1', items: [] } as any;

const mockTimelineStore = reactive({
  timelineDoc: { tracks: [videoTrack, audioTrack] },
  selectedTrackId: null,
  currentTime: 1_000_000,
  addTrack: addTrackMock,
  addClipToTimelineFromPath: addClipToTimelineFromPathMock,
  addTimelineClipToTimelineFromPath: addTimelineClipToTimelineFromPathMock,
  requestTimelineSave: requestTimelineSaveMock,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open', 'title'],
      emits: ['update:open'],
      template: '<div class="drawer"><h2>{{ title }}</h2><slot /></div>',
    },
    UButton: {
      props: ['loading', 'disabled'],
      emits: ['click'],
      template: '<button class="u-button" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
    },
    Icon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileAddToTimelineModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineDoc.tracks = [videoTrack, audioTrack];
    mockTimelineStore.selectedTrackId = null;
  });

  it('renders the drawer when open', async () => {
    const wrapper = await mountSuspended(MobileAddToTimelineModal, {
      props: { open: true, entries: [{ name: 'clip.mp4', kind: 'file', path: 'clip.mp4' }] },
      global: globalOptions,
    });
    expect(wrapper.find('.drawer').exists()).toBe(true);
  });

  it('shows the new track option and existing tracks', async () => {
    const wrapper = await mountSuspended(MobileAddToTimelineModal, {
      props: { open: true, entries: [{ name: 'clip.mp4', kind: 'file', path: 'clip.mp4' }] },
      global: globalOptions,
    });
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Video 1');
    expect(wrapper.text()).toContain('common.video');
  });

  it('adds a new video track and clip when adding to a new track', async () => {
    const newTrack = { id: 'new-track-v', kind: 'video', items: [] };
    addTrackMock.mockImplementation(() => {
      mockTimelineStore.timelineDoc.tracks.push(newTrack);
    });

    const wrapper = await mountSuspended(MobileAddToTimelineModal, {
      props: { open: true, entries: [{ name: 'clip.mp4', kind: 'file', path: 'clip.mp4' }] },
      global: globalOptions,
    });

    await wrapper.find('.u-button').trigger('click');
    expect(addTrackMock).toHaveBeenCalledWith('video', expect.any(String));
    expect(addClipToTimelineFromPathMock).toHaveBeenCalled();
    expect(wrapper.emitted('added')).toHaveLength(1);
  });

  it('adds an audio clip to an existing audio track', async () => {
    const wrapper = await mountSuspended(MobileAddToTimelineModal, {
      props: { open: true, entries: [{ name: 'audio.mp3', kind: 'file', path: 'audio.mp3' }] },
      global: globalOptions,
    });

    // Select the existing audio track
    await wrapper.findAll('button').find((b) => b.text().includes('Audio 1'))!.trigger('click');
    await wrapper.find('.u-button').trigger('click');
    expect(addClipToTimelineFromPathMock).toHaveBeenCalled();
  });
});
