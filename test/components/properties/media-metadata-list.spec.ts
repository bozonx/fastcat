import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MediaMetadataList from '~/components/properties/MediaMetadataList.vue';

vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: {
    props: ['label', 'value'],
    template: '<div class="row-mock"><span class="label">{{ label }}</span><span class="value"><slot>{{ value }}</slot></span></div>',
  },
}));

vi.mock('~/utils/audio', () => ({
  formatAudioChannels: (channels: number) => `${channels}ch`,
}));

describe('MediaMetadataList', () => {
  it('renders nothing when mediaMeta is null', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: { mediaMeta: null },
    });

    expect(component.findAll('.row-mock').length).toBe(0);
  });

  it('renders video metadata rows', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: {
        mediaMeta: {
          video: { displayWidth: 1920, displayHeight: 1080, fps: 30 },
        },
      },
    });

    const rows = component.findAll('.row-mock');
    expect(rows.length).toBe(2);
    expect(component.text()).toContain('1920x1080');
    expect(component.text()).toContain('30');
  });

  it('renders dash for missing resolution', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: {
        mediaMeta: {
          video: { displayWidth: undefined, displayHeight: undefined, fps: 30 },
        },
      },
    });

    expect(component.text()).toContain('-');
  });

  it('renders audio metadata row', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: {
        mediaMeta: {
          audio: { channels: 2, sampleRate: 48000 },
        },
      },
    });

    expect(component.text()).toContain('2ch');
    expect(component.text()).toContain('48000 Hz');
  });

  it('renders both video and audio rows', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: {
        mediaMeta: {
          video: { displayWidth: 1280, displayHeight: 720, fps: 60 },
          audio: { channels: 2, sampleRate: 44100 },
        },
      },
    });

    const rows = component.findAll('.row-mock');
    expect(rows.length).toBe(3);
  });

  it('renders dash for missing sampleRate', async () => {
    const component = await mountSuspended(MediaMetadataList, {
      props: {
        mediaMeta: {
          audio: { channels: 1, sampleRate: undefined },
        },
      },
    });

    expect(component.text()).toContain('-');
  });
});
