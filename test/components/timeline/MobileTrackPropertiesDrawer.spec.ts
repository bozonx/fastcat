import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTrackPropertiesDrawer from '~/components/timeline/MobileTrackPropertiesDrawer.vue';

vi.mock('~/components/properties/TrackProperties.vue', () => ({
  default: { template: '<div class="track-properties-stub" />' },
}));

const applyTimeline = vi.fn();
const clearSelection = vi.fn();
const deleteTrack = vi.fn();

const mockTimelineStore = reactive({
  selectedTrackId: 'track-1',
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        name: 'Video 1',
        items: [{ id: 'gap-1', kind: 'gap', timelineRange: { startUs: 0, durationUs: 1_000_000 } }],
        locked: false,
        videoHidden: false,
        audioMuted: false,
        audioSolo: false,
      },
    ],
  },
  requestTimelineSave: vi.fn(),
  updateTrackProperties: vi.fn(),
  toggleTrackAudioMuted: vi.fn(),
  toggleTrackAudioSolo: vi.fn(),
  moveTrackUp: vi.fn(),
  moveTrackDown: vi.fn(),
  addTrack: vi.fn(),
  deleteTrack,
  applyTimeline,
  clearSelection,
  renameTrack: vi.fn(),
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

describe('MobileTrackPropertiesDrawer', () => {
  beforeEach(() => {
    applyTimeline.mockReset();
    clearSelection.mockReset();
    deleteTrack.mockReset();
  });

  it('shows separate delete actions for gap mode and deletes only the selected gap', async () => {
    const wrapper = await mountSuspended(MobileTrackPropertiesDrawer, {
      props: {
        isOpen: true,
        trackId: 'track-1',
        gapItemId: 'gap-1',
      },
      global: {
        stubs: {
          MobileTimelineDrawer: {
            template: '<div><slot name="toolbar" /><slot /></div>',
          },
          MobileDrawerToolbar: {
            template: '<div><slot /></div>',
          },
          MobileDrawerToolbarButton: {
            props: ['label'],
            emits: ['click'],
            template: '<button @click="$emit(\'click\')">{{ label }}</button>',
          },
          TrackProperties: {
            template: '<div class="track-properties-stub" />',
          },
          PropertyActionList: {
            template: '<div />',
          },
          GenerateCaptionsModal: {
            template: '<div />',
          },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    const buttons = wrapper.findAll('button');

    // In gap mode there are 9 toolbar buttons (delete gap, add content, toggle track height, video, mute, solo, lock, rename, delete track)
    expect(buttons.length).toBe(9);

    const deleteGapButton = buttons[0];
    expect(deleteGapButton).toBeDefined();

    await deleteGapButton!.trigger('click');

    expect(applyTimeline).toHaveBeenCalledWith({
      type: 'delete_items',
      trackId: 'track-1',
      itemIds: ['gap-1'],
    });
    expect(clearSelection).toHaveBeenCalled();
    expect(deleteTrack).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('renders track/gap buttons in the correct order', async () => {
    // 1. Check gap mode
    const wrapperGap = await mountSuspended(MobileTrackPropertiesDrawer, {
      props: {
        isOpen: true,
        trackId: 'track-1',
        gapItemId: 'gap-1',
      },
      global: {
        stubs: {
          MobileTimelineDrawer: { template: '<div><slot name="toolbar" /><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: {
              icon: String,
              primary: Boolean,
              label: String,
            },
            template:
              '<button :data-primary="primary ? \'true\' : undefined" :data-icon="icon" :data-label="label" />',
          },
          TrackProperties: { template: '<div />' },
          GenerateCaptionsModal: { template: '<div />' },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    const buttonsGap = wrapperGap.findAll('button[data-icon]');
    expect(buttonsGap.length).toBe(9);
    expect(buttonsGap[0].attributes('data-icon')).toBe('i-heroicons-trash');
    expect(buttonsGap[0].attributes('data-primary')).toBe('true'); // gap delete is primary
    expect(buttonsGap[1].attributes('data-icon')).toBe('i-heroicons-plus'); // add content
    expect(buttonsGap[2].attributes('data-icon')).toBe('i-lucide-unfold-vertical'); // toggle track height
    expect(buttonsGap[3].attributes('data-icon')).toBe('i-heroicons-eye'); // active/disabled (visible)
    expect(buttonsGap[4].attributes('data-icon')).toBe('i-heroicons-speaker-wave'); // mute
    expect(buttonsGap[5].attributes('data-icon')).toBe('i-heroicons-musical-note'); // solo
    expect(buttonsGap[6].attributes('data-icon')).toBe('i-heroicons-lock-closed'); // lock
    expect(buttonsGap[7].attributes('data-icon')).toBe('i-heroicons-pencil-square'); // rename
    expect(buttonsGap[8].attributes('data-icon')).toBe('i-heroicons-trash'); // delete track
    expect(buttonsGap[8].attributes('data-primary')).toBeUndefined();

    // 2. Check track mode (gapItemId is null/undefined)
    const wrapperTrack = await mountSuspended(MobileTrackPropertiesDrawer, {
      props: {
        isOpen: true,
        trackId: 'track-1',
      },
      global: {
        stubs: {
          MobileTimelineDrawer: { template: '<div><slot name="toolbar" /><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: {
              icon: String,
              primary: Boolean,
              label: String,
            },
            template:
              '<button :data-primary="primary ? \'true\' : undefined" :data-icon="icon" :data-label="label" />',
          },
          TrackProperties: { template: '<div />' },
          GenerateCaptionsModal: { template: '<div />' },
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    const buttonsTrack = wrapperTrack.findAll('button[data-icon]');
    expect(buttonsTrack.length).toBe(8);
    expect(buttonsTrack[0].attributes('data-icon')).toBe('i-heroicons-plus'); // add content
    expect(buttonsTrack[1].attributes('data-icon')).toBe('i-lucide-unfold-vertical'); // toggle track height
    expect(buttonsTrack[2].attributes('data-icon')).toBe('i-heroicons-eye'); // active/disabled (visible)
    expect(buttonsTrack[3].attributes('data-icon')).toBe('i-heroicons-speaker-wave'); // mute
    expect(buttonsTrack[4].attributes('data-icon')).toBe('i-heroicons-musical-note'); // solo
    expect(buttonsTrack[5].attributes('data-icon')).toBe('i-heroicons-lock-closed'); // lock
    expect(buttonsTrack[6].attributes('data-icon')).toBe('i-heroicons-pencil-square'); // rename
    expect(buttonsTrack[7].attributes('data-icon')).toBe('i-heroicons-trash'); // delete track
  });
});
