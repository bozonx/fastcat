import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineClipTrimHandles from '~/components/timeline/TimelineClipTrimHandles.vue';

describe('TimelineClipTrimHandles', () => {
  it('renders two trim handle divs', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 100,
      },
    });

    const handles = component.findAll('.cursor-ew-resize');
    expect(handles.length).toBe(2);
  });

  it('emits trimStart on pointerdown of first handle', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 100,
      },
    });

    const firstHandle = component.findAll('.cursor-ew-resize')[0];
    await firstHandle.trigger('pointerdown');

    expect(component.emitted('trimStart')).toBeTruthy();
  });

  it('emits trimEnd on pointerdown of second handle', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 100,
      },
    });

    const secondHandle = component.findAll('.cursor-ew-resize')[1];
    await secondHandle.trigger('pointerdown');

    expect(component.emitted('trimEnd')).toBeTruthy();
  });

  it('calculates handle width as 25% of clip width clamped to 4-14px', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 200,
      },
    });

    const firstHandle = component.findAll('.cursor-ew-resize')[0];
    const widthStyle = firstHandle.attributes('style');
    expect(widthStyle).toContain('width: 14px');
  });

  it('clamps handle width to minimum 4px for very small clips', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 8,
      },
    });

    const firstHandle = component.findAll('.cursor-ew-resize')[0];
    const widthStyle = firstHandle.attributes('style');
    expect(widthStyle).toContain('width: 4px');
  });

  it('keeps trim hover feedback available', async () => {
    const component = await mountSuspended(TimelineClipTrimHandles, {
      props: {
        clipWidthPx: 100,
      },
    });

    const firstHandle = component.findAll('.cursor-ew-resize')[0];
    expect(firstHandle.classes()).toContain('hover:bg-white/15');
  });
});
