import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import MobileTransitionToolbar from '~/components/timeline/MobileTransitionToolbar.vue';

const toggleTransitionMock = vi.fn();
const updateTransitionDurationMock = vi.fn();
const updateTransitionTypeMock = vi.fn();
const updateTransitionCurveMock = vi.fn();
const updateClipTransitionMock = vi.fn();

const clipItem = {
  id: 'clip-1',
  kind: 'clip',
  timelineRange: { durationUs: 2_000_000 },
  transitionIn: null,
  transitionOut: null,
} as any;

const trackItem = {
  id: 'track-1',
  kind: 'video',
  items: [clipItem],
} as any;

const mockTimelineStore = reactive({
  timelineDoc: { tracks: [trackItem] },
  updateClipTransition: updateClipTransitionMock,
});

const selectedEntity = ref<any>({
  source: 'timeline',
  kind: 'clip',
  itemId: 'clip-1',
  trackId: 'track-1',
});

const mockSelectionStore = reactive({
  selectedEntity,
});

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: { defaultTransitionDurationUs: 1_000_000 },
  },
});

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }));
mockNuxtImport('useTimelineStore', () => () => mockTimelineStore);
mockNuxtImport('useSelectionStore', () => () => mockSelectionStore);
mockNuxtImport('useWorkspaceStore', () => () => mockWorkspaceStore);

vi.mock('~/composables/properties/useClipTransitions', () => ({
  useClipTransitions: () => ({
    transitionIn: ref(null),
    transitionOut: ref(null),
    toggleTransition: toggleTransitionMock,
    updateTransitionDuration: updateTransitionDurationMock,
    updateTransitionType: updateTransitionTypeMock,
    updateTransitionCurve: updateTransitionCurveMock,
  }),
}));

const globalOptions = {
  stubs: {
    UiSelect: {
      props: ['modelValue', 'options'],
      emits: ['update:modelValue'],
      template: '<select class="ui-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
    },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileTransitionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clip',
      itemId: 'clip-1',
      trackId: 'track-1',
    } as any;
  });

  it('renders the toolbar with IN and OUT columns', async () => {
    const wrapper = await mountSuspended(MobileTransitionToolbar, {
      global: globalOptions,
    });
    expect(wrapper.text()).toContain('fastcat.timeline.transitions');
    expect(wrapper.text()).toContain('IN');
    expect(wrapper.text()).toContain('OUT');
  });

  it('emits back when the back button is clicked', async () => {
    const wrapper = await mountSuspended(MobileTransitionToolbar, {
      global: globalOptions,
    });
    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');
    expect(wrapper.emitted('back')).toHaveLength(1);
  });

  it('emits close when the close button is clicked', async () => {
    const wrapper = await mountSuspended(MobileTransitionToolbar, {
      global: globalOptions,
    });
    const buttons = wrapper.findAll('button');
    await buttons[1]!.trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
