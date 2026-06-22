import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import MonitorInteractiveOverlay from '~/components/monitor/MonitorInteractiveOverlay.vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const rawWorkerTimelineClips = ref([
  {
    id: 'clip-1',
    clipType: 'media',
    trackId: 'track-1',
    source: { path: 'test.mp4' },
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, linked: true },
      rotationDeg: 0,
      anchor: { preset: 'center', x: 0.5, y: 0.5 },
    },
  },
  {
    id: 'clip-2',
    clipType: 'text',
    trackId: 'track-1',
    text: 'Hello',
    timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, linked: true },
      rotationDeg: 0,
      anchor: { preset: 'center', x: 0.5, y: 0.5 },
    },
  },
]);

vi.mock('~/composables/monitor/useMonitorTimeline', () => ({
  useMonitorTimeline: () => ({
    rawWorkerTimelineClips,
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    projectSettings: { project: { width: 1920, height: 1080 } },
  })),
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: vi.fn(() => ({
    getCachedMetadata: (path: string) => {
      if (path === 'test.mp4') return { video: { width: 1920, height: 1080 } };
      return null;
    },
  })),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => ({
    currentTime: 1_000_000,
    timelineFormat: { width: 1920, height: 1080 },
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: { experimentalFeatures: true },
  })),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: vi.fn(() => ({
    selectedEntity: null,
    selectTimelineItem: vi.fn(),
  })),
}));

describe('MonitorInteractiveOverlay', () => {
  beforeEach(() => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      userSettings: { experimentalFeatures: true },
    } as any);

    vi.mocked(useSelectionStore).mockReturnValue({
      selectedEntity: null,
      selectTimelineItem: vi.fn(),
    } as any);

    vi.mocked(useTimelineStore).mockReturnValue({
      currentTime: 1_000_000,
      timelineFormat: { width: 1920, height: 1080 },
    } as any);

    rawWorkerTimelineClips.value = [
      {
        id: 'clip-1',
        clipType: 'media',
        trackId: 'track-1',
        source: { path: 'test.mp4' },
        timelineRange: { startUs: 0, durationUs: 5_000_000 },
        transform: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1, linked: true },
          rotationDeg: 0,
          anchor: { preset: 'center', x: 0.5, y: 0.5 },
        },
      },
      {
        id: 'clip-2',
        clipType: 'text',
        trackId: 'track-1',
        text: 'Hello',
        timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
        transform: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1, linked: true },
          rotationDeg: 0,
          anchor: { preset: 'center', x: 0.5, y: 0.5 },
        },
      },
    ];
  });

  it('does not render when experimentalFeatures is disabled', () => {
    vi.mocked(useWorkspaceStore).mockReturnValue({
      userSettings: { experimentalFeatures: false },
    } as any);

    const wrapper = mount(MonitorInteractiveOverlay, {
      props: { renderWidth: 1920, renderHeight: 1080 },
    });

    expect(wrapper.find('g').exists()).toBe(false);
  });

  it('renders bounding box for visible clip at current time', () => {
    const wrapper = mount(MonitorInteractiveOverlay, {
      props: { renderWidth: 1920, renderHeight: 1080 },
    });

    const rects = wrapper.findAll('rect');
    expect(rects.length).toBe(1);
  });

  it('does not render bounding box for clips outside current time', () => {
    const wrapper = mount(MonitorInteractiveOverlay, {
      props: { renderWidth: 1920, renderHeight: 1080 },
    });

    const rects = wrapper.findAll('rect');
    expect(rects.length).toBe(1);
    expect(rects[0].exists()).toBe(true);
  });

  it('does not render a full-frame bounding box for adjustment clips', () => {
    rawWorkerTimelineClips.value = [
      {
        id: 'adjustment-1',
        clipType: 'adjustment',
        trackId: 'track-2',
        timelineRange: { startUs: 0, durationUs: 5_000_000 },
      },
    ] as any;

    const wrapper = mount(MonitorInteractiveOverlay, {
      props: { renderWidth: 1920, renderHeight: 1080 },
    });

    expect(wrapper.find('rect').exists()).toBe(false);
  });

  it('calls selectTimelineItem on pointerdown', async () => {
    const selectTimelineItem = vi.fn();
    vi.mocked(useSelectionStore).mockReturnValue({
      selectedEntity: null,
      selectTimelineItem,
    } as any);

    const wrapper = mount(MonitorInteractiveOverlay, {
      props: { renderWidth: 1920, renderHeight: 1080 },
    });

    const rect = wrapper.find('rect');
    expect(rect.exists()).toBe(true);

    await rect.trigger('pointerdown', { button: 0 });
    expect(selectTimelineItem).toHaveBeenCalledWith('track-1', 'clip-1', 'clip');
  });
});
