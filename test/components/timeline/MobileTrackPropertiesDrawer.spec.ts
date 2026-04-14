import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTrackPropertiesDrawer from '~/components/timeline/MobileTrackPropertiesDrawer.vue';

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
          GenerateCaptionsModal: true,
          UiConfirmModal: true,
          UiRenameModal: true,
        },
      },
    });

    const buttons = wrapper.findAll('button');
    const labels = buttons.map((button) => button.text());

    expect(labels).toContain('fastcat.timeline.deleteGap');
    expect(labels).toContain('fastcat.timeline.deleteTrack');

    const deleteGapButton = buttons.find((button) => button.text() === 'fastcat.timeline.deleteGap');
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
});
