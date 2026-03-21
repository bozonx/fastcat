import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';

// Mock components
vi.mock('~/components/ui/UiSliderInput.vue', () => ({ default: { template: '<div class="mock-slider"></div>', props: ['modelValue'] } }));
vi.mock('~/components/ui/UiButtonGroup.vue', () => ({ default: { template: '<div class="mock-btn-group"></div>', props: ['modelValue', 'options'] } }));
vi.mock('~/components/ui/UiModal.vue', () => ({ default: { template: '<div class="mock-modal"><slot name="body" /><slot /></div>', props: ['open', 'title'] } }));
vi.mock('~/components/properties/TransitionParamFields.vue', () => ({ default: { template: '<div class="mock-params"></div>' } }));

// Mock Composables
vi.mock('~/composables/timeline/useClipTransitionPanel', () => ({
  useClipTransitionPanel: () => ({
    durationMax: ref(2),
    durationMin: ref(0.1),
    durationSec: ref(1),
    durationStep: ref(0.1),
    edgeIcon: ref('i-heroicons-arrow-right-circle'),
    remove: vi.fn(),
    selectedCurve: ref('linear'),
    selectedManifest: ref({ paramFields: [] }),
    selectedMode: ref('adjacent'),
    selectedParams: ref({}),
    selectedType: ref('dissolve'),
    updateParam: vi.fn()
  })
}));

const mockPresetsStore = {
  saveAsPreset: vi.fn()
};

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore
}));

describe('ClipTransitionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    edge: 'in' as const,
    trackId: 'track-1',
    itemId: 'clip-1',
    transition: { type: 'dissolve', durationUs: 1000000, curve: 'linear', mode: 'adjacent' } as any
  };

  it('renders correctly', async () => {
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });
    
    expect(component.text()).toContain('IN');
    // Fastcat translation keys
    expect(component.text()).toContain('fastcat.timeline.transition.title');
    
    // Check if slider and button groups are rendered
    expect(component.find('.mock-slider').exists()).toBe(true);
    expect(component.findAll('.mock-btn-group').length).toBe(2); // Mode and Curve
  });

  it('can open save preset modal', async () => {
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });
    
    // The button that opens modal has the bookmark icon
    const buttons = component.findAll('button');
    const saveBtn = buttons.find(b => b.html().includes('i-heroicons-bookmark') || b.attributes('title') === 'Save as preset');
    await saveBtn!.trigger('click');
    
    const modal = component.find('.mock-modal');
    expect(modal.exists()).toBe(true);
  });
});
