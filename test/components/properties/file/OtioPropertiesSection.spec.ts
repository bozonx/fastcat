import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import OtioPropertiesSection from '~/components/properties/file/OtioPropertiesSection.vue';

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    props: ['title'],
    template: '<div class="section-mock"><slot /></div>',
  },
}));

vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: {
    props: ['label', 'value'],
    template: '<div class="row-mock" :data-label="label">{{ value }}</div>',
  },
}));

describe('OtioPropertiesSection', () => {
  const formatDurationSeconds = (s: number) => `${s.toFixed(2)}s`;

  it('renders summary rows when summary provided', async () => {
    const component = await mountSuspended(OtioPropertiesSection, {
      props: {
        summary: {
          durationTicks: 1_270_080_000_000,
          videoTracks: 2,
          audioTracks: 3,
          clips: 12,
          version: 4,
        },
        formatDurationSeconds,
      },
    });

    const rows = component.findAll('.row-mock');
    expect(rows.length).toBe(5);
    expect(rows[0]!.attributes('data-label')).toBe('common.duration');
    expect(rows[0]!.text()).toBe('5.00s');
    expect(rows[1]!.attributes('data-label')).toBe('fastcat.timeline.videoTracks');
    expect(rows[1]!.text()).toBe('2');
    expect(rows[4]!.attributes('data-label')).toBe('fastcat.timeline.version');
    expect(rows[4]!.text()).toBe('4');
  });

  it('omits version row when version is null', async () => {
    const component = await mountSuspended(OtioPropertiesSection, {
      props: {
        summary: { durationTicks: 0, videoTracks: 0, audioTracks: 0, clips: 0, version: null },
        formatDurationSeconds,
      },
    });

    const labels = component.findAll('.row-mock').map((r) => r.attributes('data-label'));
    expect(labels).not.toContain('fastcat.timeline.version');
  });

  it('renders OTIO type row when summary is null', async () => {
    const component = await mountSuspended(OtioPropertiesSection, {
      props: { summary: null, formatDurationSeconds },
    });

    const rows = component.findAll('.row-mock');
    expect(rows.length).toBe(1);
    expect(rows[0]!.attributes('data-label')).toBe('common.type');
    expect(rows[0]!.text()).toBe('OTIO');
  });
});
