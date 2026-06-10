import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTrackManagerDrawer from '~/components/timeline/MobileTrackManagerDrawer.vue';

const addTrack = vi.fn();
const deleteTrack = vi.fn();
const reorderTracks = vi.fn();
const updateTrackProperties = vi.fn();
const toggleTrackAudioMuted = vi.fn();
const toggleTrackAudioSolo = vi.fn();
const requestTimelineSave = vi.fn();

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        name: 'Video 1',
        items: [],
        locked: false,
        videoHidden: false,
        audioMuted: false,
        audioSolo: false,
      },
      {
        id: 'track-2',
        kind: 'audio',
        name: 'Audio 1',
        items: [],
        locked: true,
        videoHidden: false,
        audioMuted: true,
        audioSolo: false,
      },
    ],
  },
  addTrack,
  deleteTrack,
  reorderTracks,
  updateTrackProperties,
  toggleTrackAudioMuted,
  toggleTrackAudioSolo,
  requestTimelineSave,
});

const mockWorkspaceStore = reactive({
  userSettings: {
    deleteWithoutConfirmation: true,
  },
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// Mock VueDraggable to simplify rendering in tests
vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    props: ['modelValue'],
    template: '<div class="draggable-stub"><slot /></div>',
  },
}));

describe('MobileTrackManagerDrawer', () => {
  beforeEach(() => {
    addTrack.mockReset();
    deleteTrack.mockReset();
    reorderTracks.mockReset();
    updateTrackProperties.mockReset();
    toggleTrackAudioMuted.mockReset();
    toggleTrackAudioSolo.mockReset();
    requestTimelineSave.mockReset();
  });

  it('renders all tracks and buttons', async () => {
    const wrapper = await mountSuspended(MobileTrackManagerDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            template: '<div class="drawer-stub"><slot /></div>',
          },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Video 1');
    expect(wrapper.text()).toContain('Audio 1');

    // Add track buttons at the bottom
    const buttons = wrapper.findAll('button');
    const addVideoBtn = buttons.find((b) => b.text().includes('Video'));
    const addAudioBtn = buttons.find((b) => b.text().includes('Audio'));

    expect(addVideoBtn).toBeDefined();
    expect(addAudioBtn).toBeDefined();
  });

  it('handles toggle visibility, mute, solo, and lock', async () => {
    const wrapper = await mountSuspended(MobileTrackManagerDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            template: '<div class="drawer-stub"><slot /></div>',
          },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    // Toggle mute on track-1 (video track)
    // Buttons inside track: eye, speaker, musical-note (solo), lock
    // Track-1 index 0 in list. Let's find buttons inside the list item
    const trackItems = wrapper.findAll('.draggable-stub > div');
    expect(trackItems.length).toBe(2);

    const firstTrackButtons = trackItems[0].findAll('button');
    // For video track: index 0 = visibility, index 1 = mute, index 2 = solo, index 3 = lock
    expect(firstTrackButtons.length).toBe(4);

    // Toggle Visibility
    await firstTrackButtons[0].trigger('click');
    expect(updateTrackProperties).toHaveBeenCalledWith('track-1', { videoHidden: true });
    expect(requestTimelineSave).toHaveBeenCalled();

    // Toggle Mute
    await firstTrackButtons[1].trigger('click');
    expect(toggleTrackAudioMuted).toHaveBeenCalledWith('track-1');

    // Toggle Solo
    await firstTrackButtons[2].trigger('click');
    expect(toggleTrackAudioSolo).toHaveBeenCalledWith('track-1');

    // Toggle Lock
    await firstTrackButtons[3].trigger('click');
    expect(updateTrackProperties).toHaveBeenCalledWith('track-1', { locked: true });
  });

  it('handles delete track via drag and drop', async () => {
    const elementFromPointSpy = vi.spyOn(document, 'elementFromPoint').mockImplementation(() => {
      const div = document.createElement('div');
      div.className = 'delete-drop-zone';
      return div;
    });

    const wrapper = await mountSuspended(MobileTrackManagerDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            template: '<div class="drawer-stub"><slot /></div>',
          },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    // Find the VueDraggable wrapper
    const draggable = wrapper.findComponent({ name: 'VueDraggable' });
    expect(draggable.exists()).toBe(true);

    // Emit 'end' event to simulate drop over delete zone
    await draggable.vm.$emit('end', {
      oldIndex: 0,
      originalEvent: {
        clientX: 100,
        clientY: 100,
      },
    });

    expect(deleteTrack).toHaveBeenCalledWith('track-1', { allowNonEmpty: true });

    elementFromPointSpy.mockRestore();
  });

  it('handles add tracks', async () => {
    const wrapper = await mountSuspended(MobileTrackManagerDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          UiMobileDrawer: {
            template: '<div class="drawer-stub"><slot /></div>',
          },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    // The last two buttons are "Add Video" and "Add Audio"
    const buttons = wrapper.findAll('.pt-4 button');
    expect(buttons.length).toBe(2);

    // Click Add Video
    await buttons[0].trigger('click');
    expect(addTrack).toHaveBeenCalledWith('video', 'Video 2');

    // Click Add Audio
    await buttons[1].trigger('click');
    expect(addTrack).toHaveBeenCalledWith('audio', 'Audio 2');
  });
});
