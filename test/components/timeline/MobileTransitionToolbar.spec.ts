import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import MobileTransitionToolbar from '~/components/timeline/MobileTransitionToolbar.vue';
import { TICKS_PER_SECOND } from '~/utils/time';

const toggleTransitionMock = vi.fn();
const updateTransitionDurationMock = vi.fn();
const updateTransitionTypeMock = vi.fn();
const updateTransitionCurveMock = vi.fn();
const updateClipTransitionMock = vi.fn();
const selectTransitionMock = vi.fn();
const transitionInRef = ref<any>(null);
const transitionOutRef = ref<any>(null);

const clipItem = {
  id: 'clip-1',
  kind: 'clip',
  timelineRange: { durationTicks: 2 * TICKS_PER_SECOND },
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
  selectTransition: selectTransitionMock,
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
    timeline: { defaultTransitionDurationTicks: TICKS_PER_SECOND },
  },
});

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }));
mockNuxtImport('useTimelineStore', () => () => mockTimelineStore);
mockNuxtImport('useSelectionStore', () => () => mockSelectionStore);
mockNuxtImport('useWorkspaceStore', () => () => mockWorkspaceStore);

vi.mock('~/composables/properties/useClipTransitions', () => ({
  useClipTransitions: () => ({
    transitionIn: transitionInRef,
    transitionOut: transitionOutRef,
    toggleTransition: toggleTransitionMock,
    updateTransitionDuration: updateTransitionDurationMock,
    updateTransitionType: updateTransitionTypeMock,
    updateTransitionCurve: updateTransitionCurveMock,
  }),
}));

const globalOptions = {
  stubs: {
    UiSelect: {
      props: ['modelValue', 'items'],
      emits: ['update:modelValue'],
      template:
        '<select class="ui-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="opt in items" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>',
    },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

function createTouchEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: [{ clientX }],
  });
  Object.defineProperty(event, 'changedTouches', {
    value: [{ clientX }],
  });
  return event;
}

describe('MobileTransitionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'clip',
      itemId: 'clip-1',
      trackId: 'track-1',
    } as any;
    transitionInRef.value = null;
    transitionOutRef.value = null;
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

  it('updates transition duration while swiping before touch end', async () => {
    transitionInRef.value = {
      type: 'dissolve',
      durationTicks: 0.5 * TICKS_PER_SECOND,
      curve: 'linear',
      mode: 'adjacent',
    };

    const wrapper = await mountSuspended(MobileTransitionToolbar, {
      global: globalOptions,
    });

    const durationControl = wrapper.find('[data-testid="mobile-transition-duration-in"]');
    durationControl.element.dispatchEvent(createTouchEvent('touchstart', 0));
    await nextTick();
    durationControl.element.dispatchEvent(createTouchEvent('touchmove', 50));
    await nextTick();

    expect(updateTransitionDurationMock).toHaveBeenCalledWith('in', 1);
  });

  it('selects transition and opens settings from type row button', async () => {
    transitionInRef.value = {
      type: 'dissolve',
      durationTicks: 0.5 * TICKS_PER_SECOND,
      curve: 'linear',
      mode: 'adjacent',
    };

    const wrapper = await mountSuspended(MobileTransitionToolbar, {
      global: globalOptions,
    });

    const settingsButton = wrapper
      .findAll('button')
      .find((button) => button.html().includes('i-heroicons-adjustments-horizontal'));
    await settingsButton!.trigger('click');

    expect(selectTransitionMock).toHaveBeenCalledWith({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });
    expect(wrapper.emitted('open-settings')).toHaveLength(1);
  });
});
