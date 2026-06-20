import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MultiClipTimingSection from '~/components/properties/multi-clip/MultiClipTimingSection.vue';

describe('MultiClipTimingSection.vue', () => {
  const defaultProps = {
    firstClip: {
      id: 'clip-1',
      timelineRange: { durationUs: 5_000_000 },
    } as any,
    durationShiftAccumulator: 0,
    startShiftAccumulator: 0,
    endShiftAccumulator: 0,
    hideUniformDuration: false,
  };

  it('renders the clip information section by default', async () => {
    const wrapper = await mountSuspended(MultiClipTimingSection, {
      props: defaultProps,
      global: {
        stubs: {
          PropertySection: {
            props: ['title'],
            template: '<div data-testid="timing-section" :data-title="title"><slot /></div>',
          },
          PropertyTimecode: {
            props: ['label'],
            template: '<div data-testid="property-timecode">{{ label }}</div>',
          },
          PropertyField: {
            template: '<div class="property-field"><slot /></div>',
          },
          UiTimecode: {
            template: '<input data-testid="ui-timecode" />',
          },
        },
      },
    });

    expect(wrapper.find('[data-testid="timing-section"]').exists()).toBe(true);
  });

  it('hides the clip information section when isMobile is true', async () => {
    const wrapper = await mountSuspended(MultiClipTimingSection, {
      props: { ...defaultProps, isMobile: true },
      global: {
        stubs: {
          PropertySection: {
            props: ['title'],
            template: '<div data-testid="timing-section" :data-title="title"><slot /></div>',
          },
          PropertyTimecode: {
            props: ['label'],
            template: '<div data-testid="property-timecode">{{ label }}</div>',
          },
          PropertyField: {
            template: '<div class="property-field"><slot /></div>',
          },
          UiTimecode: {
            template: '<input data-testid="ui-timecode" />',
          },
        },
      },
    });

    expect(wrapper.find('[data-testid="timing-section"]').exists()).toBe(false);
  });
});
