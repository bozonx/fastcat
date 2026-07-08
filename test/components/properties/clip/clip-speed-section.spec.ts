import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineClipItem } from '~/timeline/types';
import ClipSpeedSection from '~/components/properties/clip/ClipSpeedSection.vue';

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: ['modelValue', 'min', 'max', 'step', 'unit', 'defaultValue', 'disabled', 'label', 'wheelStepMultiplier'],
    emits: ['update:modelValue'],
    template:
      '<input type="range" class="slider-mock" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    props: {
      title: { type: String, default: '' },
      hasToggle: { type: Boolean, default: false },
      showReset: { type: Boolean, default: false },
      onReset: { type: Function, default: null },
    },
    emits: ['update:enabled'],
    template:
      '<div class="section-mock"><h3>{{ title }}</h3><button v-if="showReset" class="reset-btn" @click="onReset">reset</button><slot /></div>',
  },
}));

function createClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('ClipSpeedSection', () => {
  it('does not render when canEditReversed is false', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip(), canEditReversed: false, trackKind: 'video' },
    });

    expect(component.find('.section-mock').exists()).toBe(false);
  });

  it('renders when canEditReversed is true', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip(), canEditReversed: true, trackKind: 'video' },
    });

    expect(component.find('.section-mock').exists()).toBe(true);
  });

  it('passes speed value (rounded) to slider', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip({ speed: 1.236 } as any), canEditReversed: true, trackKind: 'video' },
    });

    expect(component.find('.slider-mock').attributes('value')).toBe('1.24');
  });

  it('emits updateSpeed when slider changes', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip({ speed: 1 } as any), canEditReversed: true, trackKind: 'video' },
    });

    await component.find('.slider-mock').setValue(2);

    expect(component.emitted('updateSpeed')).toBeTruthy();
    expect(component.emitted('updateSpeed')![0]).toEqual([2]);
  });

  it('emits updateSpeed 1 when reset clicked', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip({ speed: 2 } as any), canEditReversed: true, trackKind: 'video' },
    });

    await component.find('.reset-btn').trigger('click');

    expect(component.emitted('updateSpeed')![0]).toEqual([1]);
  });

  it('shows reverse audio warning when speed negative and clip has audio', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip({ speed: -1 } as any), canEditReversed: true, trackKind: 'audio' },
    });

    expect(component.text()).toContain('reverseAudioWarning');
  });

  it('does not show reverse audio warning when speed positive', async () => {
    const component = await mountSuspended(ClipSpeedSection, {
      props: { clip: createClip({ speed: 2 } as any), canEditReversed: true, trackKind: 'audio' },
    });

    expect(component.text()).not.toContain('reverseAudioWarning');
  });
});
