import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineClipItem } from '~/timeline/types';
import ClipMaskSection from '~/components/properties/clip/ClipMaskSection.vue';

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

vi.mock('~/components/properties/ParamsRenderer.vue', () => ({
  default: {
    props: ['controls', 'values', 'disabled'],
    emits: ['update:value'],
    template:
      '<div class="params-mock"><button class="emit-source" @click="$emit(\'update:value\', \'sourcePath\', \'/foo\')" /><button class="emit-empty" @click="$emit(\'update:value\', \'sourcePath\', \'\')" /><button class="emit-mode" @click="$emit(\'update:value\', \'mode\', \'luma\')" /><button class="emit-invert" @click="$emit(\'update:value\', \'invert\', true)" /></div>',
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

describe('ClipMaskSection', () => {
  it('renders section', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip() },
    });

    expect(component.find('.section-mock').exists()).toBe(true);
  });

  it('emits updateMask undefined when reset clicked', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip({ mask: { source: { path: '/x' }, mode: 'alpha', invert: false } } as any) },
    });

    await component.find('.reset-btn').trigger('click');

    expect(component.emitted('updateMask')).toBeTruthy();
    expect(component.emitted('updateMask')![0]).toEqual([undefined]);
  });

  it('emits updateMask with source when sourcePath value provided', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip() },
    });

    await component.find('.emit-source').trigger('click');

    expect(component.emitted('updateMask')![0]).toEqual([
      { source: { path: '/foo' } },
    ]);
  });

  it('emits updateMask undefined when sourcePath cleared', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip({ mask: { source: { path: '/x' }, mode: 'alpha' } } as any) },
    });

    await component.find('.emit-empty').trigger('click');

    expect(component.emitted('updateMask')![0]).toEqual([undefined]);
  });

  it('emits updateMask with mode when mode value changes', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip({ mask: { source: { path: '/x' }, mode: 'alpha' } } as any) },
    });

    await component.find('.emit-mode').trigger('click');

    expect(component.emitted('updateMask')![0]).toEqual([
      { source: { path: '/x' }, mode: 'luma' },
    ]);
  });

  it('emits updateMask with invert when invert value changes', async () => {
    const component = await mountSuspended(ClipMaskSection, {
      props: { clip: createClip({ mask: { source: { path: '/x' }, mode: 'alpha' } } as any) },
    });

    await component.find('.emit-invert').trigger('click');

    expect(component.emitted('updateMask')![0]).toEqual([
      { source: { path: '/x' }, mode: 'alpha', invert: true },
    ]);
  });
});
