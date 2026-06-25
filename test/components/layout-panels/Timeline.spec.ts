import { ref, defineComponent } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime';
import { useTimelineStore } from '~/stores/timeline.store';
import Timeline from '~/components/layout-panels/EditorTimeline.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

mockComponent(
  'UContextMenu',
  defineComponent({
    setup(props, { slots }) {
      return () => (slots.default ? slots.default() : null);
    },
  }),
);

mockComponent(
  'UDropdownMenu',
  defineComponent({
    setup(props, { slots }) {
      return () => (slots.default ? slots.default() : null);
    },
  }),
);

mockComponent(
  'UButton',
  defineComponent({
    props: ['icon', 'variant', 'size', 'label', 'class', 'style'],
    emits: ['click'],
    template:
      '<button :data-icon="icon" :data-label="label" @click="$emit(\'click\')">{{ label }}<slot /></button>',
  }),
);

// Mock composables to avoid side effects
vi.mock('~/composables/timeline/useTimelineSectionResize', async () => {
  const { ref } = await import('vue');
  return {
    useTimelineSectionResize: () => ({
      videoSectionPercent: ref(50),
      sectionContainerRef: ref(null),
      onSectionResizeStart: globalThis.vi.fn(),
      resetSectionPercent: globalThis.vi.fn(),
    }),
  };
});

describe('Timeline Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up real store state instead of mocking the whole store
    const timelineStore = useTimelineStore();
    timelineStore.currentTime = 10_000_000;
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          locked: false,
          items: [],
          name: 'Video 1',
          opacity: 100,
          muted: false,
          hidden: false,
          blendMode: 'normal',
        },
        {
          id: 'a1',
          kind: 'audio',
          locked: true,
          items: [],
          name: 'Audio 1',
          opacity: 100,
          muted: false,
          hidden: false,
          blendMode: 'normal',
        },
      ],
    } as any;
    // Mock actions
    timelineStore.unlockAllTracks = vi.fn();
    timelineStore.setCurrentTimeUs = vi.fn();
  });

  it('renders correctly with all sections', async () => {
    const component = await mountSuspended(Timeline);

    // Check main components
    expect(component.findComponent({ name: 'TimelineToolbar' }).exists()).toBe(true);
    expect(component.findComponent({ name: 'TimelineRuler' }).exists()).toBe(true);
    expect(component.findAllComponents({ name: 'TimelineTrackSection' }).length).toBe(2);
  });

  it('keeps the horizontal scroll viewport aligned with the track area', async () => {
    const component = await mountSuspended(Timeline);
    const masterScroll = component.find('.timeline-master-scroll');
    const scrollRow = masterScroll.element.parentElement as HTMLElement;
    const labelSpacer = scrollRow.firstElementChild as HTMLElement;

    expect(labelSpacer.getAttribute('style')).toContain('width: 220px');
    expect(masterScroll.classes()).toContain('flex-1');
  });

  it('displays correct timecode from store', async () => {
    const component = await mountSuspended(Timeline);
    const timecode = component.findComponent(UiTimecode);

    expect(timecode.props('modelValue')).toBe(10_000_000);
  });

  it('shows lock reset button when a track is locked', async () => {
    const component = await mountSuspended(Timeline);

    // Track 'a1' has locked: true in beforeEach, so the lock reset button should be rendered
    const lockButton = component.find('button[data-icon="i-heroicons-lock-closed"]');
    expect(lockButton.exists()).toBe(true);
  });

  it('does not show lock reset button when no tracks are locked', async () => {
    const timelineStore = useTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          locked: false,
          items: [],
          name: 'Video 1',
          opacity: 100,
          muted: false,
          hidden: false,
          blendMode: 'normal',
        },
        {
          id: 'a1',
          kind: 'audio',
          locked: false,
          items: [],
          name: 'Audio 1',
          opacity: 100,
          muted: false,
          hidden: false,
          blendMode: 'normal',
        },
      ],
    } as any;

    const component = await mountSuspended(Timeline);

    const lockButton = component.find('button[data-icon="i-heroicons-lock-closed"]');
    expect(lockButton.exists()).toBe(false);
  });

  it('calls unlockAllTracks when reset lock button is clicked', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);

    const lockButton = component.find('button[data-icon="i-heroicons-lock-closed"]');
    expect(lockButton.exists()).toBe(true);
    await lockButton.trigger('click');

    expect(timelineStore.unlockAllTracks).toHaveBeenCalledTimes(1);
  });

  it('updates current time via timecode', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);
    const timecode = component.findComponent(UiTimecode);

    await timecode.vm.$emit('update:modelValue', 20_000_000);
    expect(timelineStore.setCurrentTimeUs).toHaveBeenCalledWith(20_000_000);
  });
});
