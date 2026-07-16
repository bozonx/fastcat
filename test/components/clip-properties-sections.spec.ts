import { describe, expect, it } from 'vitest';
import { mountWithNuxt } from '../utils/mount';
import { timelineTicks } from '../unit/utils/timeline-time';
import ClipActionsSection from '~/components/properties/clip/ClipActionsSection.vue';
import ClipInfoSection from '~/components/properties/clip/ClipInfoSection.vue';
import PropertyTimecode from '~/components/properties/PropertyTimecode.vue';
import type { TimelineClipItem } from '~/timeline/types';

function createClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    id: 'clip-1',
    trackId: 'v1',
    name: 'Clip 1',
    clipType: 'media',
    timelineRange: { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(2_000_000) },
    sourceRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
    sourceDurationTicks: timelineTicks(10_000_000),
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
    expect(buttons[1]?.attributes('title')).toContain('Rename');
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

  it('shows clip duration as read-only text above start and end timecodes', async () => {
    const wrapper = await mountWithNuxt(ClipInfoSection, {
      props: {
        clip: createClip(),
        mediaMeta: null,
        showSource: false,
      },
    });

    expect(wrapper.text()).toContain('00:00:02:00');
    expect(wrapper.text()).toContain('common.position');
    expect(wrapper.text()).toContain('common.end');
    expect(wrapper.findAll('input')).toHaveLength(2);
    expect(wrapper.emitted('updateDuration')).toBeUndefined();
  });

  it('caps the End field at startTicks + sourceDurationTicks for media clips', async () => {
    const clip = createClip({
      timelineRange: { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(2_000_000) },
      sourceDurationTicks: timelineTicks(10_000_000),
      speed: 1.0,
    });
    const wrapper = await mountWithNuxt(ClipInfoSection, {
      props: { clip, mediaMeta: null, showSource: false },
    });

    const timecodes = wrapper.findAllComponents(PropertyTimecode);
    // [0] = position, [1] = end
    const endField = timecodes[1]!;
    // max = startTicks (1_000_000) + sourceDurationTicks (10_000_000)
    expect(endField.props('max')).toBe(timelineTicks(11_000_000));
    expect(endField.props('min')).toBe(0);
    expect(timecodes[0]!.props('min')).toBe(0);
  });

  it('leaves the End field unbounded for image clips', async () => {
    const clip = createClip({
      clipType: 'media',
      isImage: true,
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
      sourceDurationTicks: timelineTicks(10_000_000),
      speed: 1.0,
    });
    const wrapper = await mountWithNuxt(ClipInfoSection, {
      props: { clip, mediaMeta: null, showSource: false },
    });

    const timecodes = wrapper.findAllComponents(PropertyTimecode);
    const endField = timecodes[1]!;
    // images have no source limit -> max is Infinity
    expect(endField.props('max')).toBe(Number.POSITIVE_INFINITY);
  });

  it('scales the End cap by speed (2x -> half duration)', async () => {
    const clip = createClip({
      timelineRange: { startTicks: 0, durationTicks: timelineTicks(2_000_000) },
      sourceDurationTicks: timelineTicks(10_000_000),
      speed: 2.0,
    });
    const wrapper = await mountWithNuxt(ClipInfoSection, {
      props: { clip, mediaMeta: null, showSource: false },
    });

    const timecodes = wrapper.findAllComponents(PropertyTimecode);
    // max = 0 + (10_000_000 / 2) = 5_000_000
    expect(timecodes[1]!.props('max')).toBe(timelineTicks(5_000_000));
  });
});
