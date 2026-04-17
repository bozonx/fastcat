import { describe, expect, it } from 'vitest';
import { mountWithNuxt } from '../utils/mount';
import ClipActionsSection from '~/components/properties/clip/ClipActionsSection.vue';
import ClipInfoSection from '~/components/properties/clip/ClipInfoSection.vue';
import type { TimelineClipItem } from '~/timeline/types';

function createClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    id: 'clip-1',
    trackId: 'v1',
    name: 'Clip 1',
    clipType: 'media',
    timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
    sourceRange: { startUs: 0, durationUs: 2_000_000 },
    sourceDurationUs: 10_000_000,
    source: { path: 'media/test.mp4' },
    ...overrides,
  } as TimelineClipItem;
}

describe('clip properties sections', () => {
  it('emits actions from ClipActionsSection', async () => {
    const commonActions = [
      { id: 'delete', label: 'Delete', icon: 'i-heroicons-trash', onClick: () => {} },
      { id: 'rename', label: 'Rename', icon: 'i-heroicons-pencil', onClick: () => {} },
      { id: 'copy', label: 'Copy', icon: 'i-heroicons-document-duplicate', onClick: () => {} },
      { id: 'cut', label: 'Cut', icon: 'i-heroicons-scissors', onClick: () => {} },
    ];
    const otherActions = [
      { id: 'quantize', label: 'Quantize', icon: 'i-heroicons-squares-2x2', onClick: () => {} },
    ];

    const wrapper = await mountWithNuxt(ClipActionsSection, {
      props: {
        commonActions,
        otherActions,
      },
    });

    const buttons = wrapper.findAll('button');

    expect(buttons[0]?.text()).toBe('');
    expect(buttons[1]?.attributes('title')).toBe('Rename');
    expect(wrapper.text()).toContain('Quantize');
    expect(wrapper.text()).not.toContain('Rename');

    await buttons[1]?.trigger('click');

    expect(wrapper.emitted('rename')).toHaveLength(1);
  });

  it('renders media source info in ClipInfoSection', async () => {
    const wrapper = await mountWithNuxt(ClipInfoSection, {
      props: {
        clip: createClip(),
        mediaMeta: {
          video: {
            displayWidth: 1920,
            displayHeight: 1080,
            fps: 30,
          },
          audio: {
            channels: 2,
            sampleRate: 48_000,
          },
        },
      },
    });

    expect(wrapper.text()).toContain('media/test.mp4');
    expect(wrapper.text()).toContain('1920x1080');
    expect(wrapper.text()).toContain('30');
    expect(wrapper.text()).toContain('48000 Hz');
  });
});
