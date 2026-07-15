import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { TICKS_PER_SECOND } from '~/utils/time';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';

vi.stubGlobal('useDevice', () => ({ isMobile: false }));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: { name: 'PropertySection', props: ['title'], template: '<section><slot /></section>' },
}));

vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: {
    name: 'PropertyActionsBlock',
    props: ['quickActions', 'additionalActions'],
    template: '<div data-testid="actions-block"></div>',
  },
}));

vi.mock('~/components/properties/PropertyTimecode.vue', () => ({
  default: {
    name: 'PropertyTimecode',
    props: ['label', 'modelValue', 'min', 'max'],
    template: '<div></div>',
  },
}));

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [],
    metadata: { fastcat: {} },
  },
  fps: 30,
  timelineFormat: null as { fps: number } | null,
  getSelectionRange: vi.fn(() => ({ startUs: TICKS_PER_SECOND, endUs: 5 * TICKS_PER_SECOND })),
  updateSelectionRange: vi.fn(),
  convertSelectionRangeToMarker: vi.fn(),
  rippleTrimSelectionRange: vi.fn(),
  removeSelectionRange: vi.fn(),
});

const mockSelectionStore = reactive({
  selectedEntity: null,
  clearSelection: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));

describe('SelectionRangeProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.getSelectionRange.mockReturnValue({
      startUs: TICKS_PER_SECOND,
      endUs: 5 * TICKS_PER_SECOND,
    });
    mockTimelineStore.fps = 30;
    mockTimelineStore.timelineFormat = null;
  });

  it('shows convert and ripple-trim in mainActions on desktop', async () => {
    const wrapper = await mountSuspended(SelectionRangeProperties);

    const mainActions = (wrapper.vm as any).mainActions as Array<{ id: string; hidden?: boolean }>;
    const convertAction = mainActions.find((a) => a.id === 'convert');
    const rippleTrimAction = mainActions.find((a) => a.id === 'ripple-trim');

    expect(convertAction).toBeDefined();
    expect(convertAction?.hidden).toBeFalsy();

    expect(rippleTrimAction).toBeDefined();
    expect(rippleTrimAction?.hidden).toBeFalsy();
  });

  it('shows actions section on desktop', async () => {
    const wrapper = await mountSuspended(SelectionRangeProperties);

    const sections = wrapper.findAll('section');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('shows actions section on mobile', async () => {
    const wrapper = await mountSuspended(SelectionRangeProperties, {
      props: { isMobile: true },
    });

    const sections = wrapper.findAll('section');
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('shows selection duration below start and end timecodes', async () => {
    const wrapper = await mountSuspended(SelectionRangeProperties);

    expect(wrapper.text()).toContain('00:00:04:00');
  });

  it('binds min=0 to start and end timecode fields', async () => {
    const wrapper = await mountSuspended(SelectionRangeProperties);

    const fields = wrapper.findAllComponents({ name: 'PropertyTimecode' });
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field.props('min')).toBe(0);
    }
  });
});
