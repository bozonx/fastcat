import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';

vi.mock('~/utils/hotkeys/layerUtils', () => ({
  isLayer1Active: (e: Event) => (e as any).shiftKey,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => ({
    timelineFormat: {
      fps: 30,
    },
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    userSettings: {},
  })),
}));

describe('UiTimecode', () => {
  it('formats modelValue correctly to HH:MM:SS:FF', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
      },
    });

    const input = component.find('input');
    expect((input.element as HTMLInputElement).value).toBe('00:00:01:00');
  });

  it('formats partial seconds to frames correctly', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: (1_000_000 / 30) * 5, // exactly 5 frames
      },
    });

    const input = component.find('input');
    expect((input.element as HTMLInputElement).value).toBe('00:00:00:05');
  });

  it('emits update:modelValue with parsed microseconds on Enter', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 0,
      },
    });

    const input = component.find('input');
    await input.trigger('focus');
    await input.setValue('00:00:02:15');
    await input.trigger('keydown', { key: 'Enter' });

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([2_500_000]);
  });

  it('reverts to valid prop value if input is invalid on blur', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
      },
    });

    const input = component.find('input');
    await input.trigger('focus');
    await input.setValue('invalid:timecode');
    await input.trigger('blur');

    expect(component.emitted('update:modelValue')).toBeFalsy();
    expect((input.element as HTMLInputElement).value).toBe('00:00:01:00');
  });

  it('steps value up and down via up/down buttons', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
      },
    });

    const buttons = component.findAll('button');
    const upButton = buttons[0];
    const downButton = buttons[1];

    await upButton.trigger('click');
    expect(component.emitted('update:modelValue')?.[0]).toEqual([1_000_000 + 1_000_000 / 30]);

    await downButton.trigger('click');
    expect(component.emitted('update:modelValue')?.[1]).toEqual([1_000_000 - 1_000_000 / 30]);
  });

  it('steps value up and down via arrow keys', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
      },
    });

    const input = component.find('input');

    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(component.emitted('update:modelValue')?.[0]).toEqual([1_000_000 + 1_000_000 / 30]);

    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(component.emitted('update:modelValue')?.[1]).toEqual([1_000_000 - 1_000_000 / 30]);
  });

  it('does not update localValue from props when focused', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 0,
      },
    });

    const input = component.find('input');
    await input.trigger('focus');
    await input.setValue('00:00:01:00');

    await component.setProps({ modelValue: 2_000_000 });

    expect((input.element as HTMLInputElement).value).toBe('00:00:01:00');
  });

  it('handles mouse wheel scrolling only when focused by default', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
      },
    });

    const input = component.find('input');

    // Scroll without focus - should NOT emit
    await input.trigger('wheel', { deltaY: -100 });
    expect(component.emitted('update:modelValue')).toBeFalsy();

    // Focus and scroll - should emit
    await input.trigger('focus');
    await input.trigger('wheel', { deltaY: -100 });
    expect(component.emitted('update:modelValue')).toBeTruthy();
  });

  it('handles mouse wheel scrolling without focus when wheelWithoutFocus is true', async () => {
    const component = await mountSuspended(UiTimecode, {
      props: {
        modelValue: 1_000_000,
        wheelWithoutFocus: true,
      },
    });

    const input = component.find('input');

    // Scroll without focus - should emit because of the prop
    await input.trigger('wheel', { deltaY: -100 });
    expect(component.emitted('update:modelValue')).toBeTruthy();
  });

  describe('bounds (min/max)', () => {
    const frameUs = 1_000_000 / 30;

    it('clamps manual entry to max on Enter', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 1_000_000, max: 2_000_000 },
      });

      const input = component.find('input');
      await input.trigger('focus');
      await input.setValue('00:00:10:00'); // 10s, well above 2s max
      await input.trigger('keydown', { key: 'Enter' });

      expect(component.emitted('update:modelValue')?.[0]).toEqual([2_000_000]);
      expect((input.element as HTMLInputElement).value).toBe('00:00:02:00');
    });

    it('clamps manual entry to min on Enter', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 1_000_000, min: 500_000 },
      });

      const input = component.find('input');
      await input.trigger('focus');
      await input.setValue('00:00:00:00'); // 0, below min 500ms
      await input.trigger('keydown', { key: 'Enter' });

      expect(component.emitted('update:modelValue')?.[0]).toEqual([500_000]);
    });

    it('clamps step (up button) to max', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 1_990_000, max: 2_000_000 },
      });

      const input = component.find('input');
      await input.trigger('focus');
      // up arrow adds one frame; 1.99s + 1 frame (~33ms) exceeds the 2s cap
      await input.trigger('keydown', { key: 'ArrowUp' });

      expect(component.emitted('update:modelValue')?.[0]).toEqual([2_000_000]);
    });

    it('clamps step (down) to min at 0', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 0, min: 0 },
      });

      const buttons = component.findAll('button');
      // Unfocused step emits unconditionally; 0 - 1 frame is clamped to 0.
      await buttons[1]!.trigger('click');

      expect(component.emitted('update:modelValue')?.[0]).toEqual([0]);
    });

    it('does not clamp when max is Infinity/omitted', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 1_000_000 },
      });

      const input = component.find('input');
      await input.trigger('focus');
      await input.setValue('00:10:00:00'); // 10 minutes
      await input.trigger('keydown', { key: 'Enter' });

      expect(component.emitted('update:modelValue')?.[0]).toEqual([600_000_000]);
    });

    it('defaults lower bound to 0 when allowNegative is false', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 0 },
      });

      const buttons = component.findAll('button');
      await buttons[1]!.trigger('click'); // down by one frame

      expect(component.emitted('update:modelValue')?.[0]).toEqual([0]);
    });

    it('allows negative values when allowNegative is true and no min', async () => {
      const component = await mountSuspended(UiTimecode, {
        props: { modelValue: 0, allowNegative: true },
      });

      const input = component.find('input');
      await input.trigger('focus');
      await input.setValue('-00:00:01:00');
      await input.trigger('keydown', { key: 'Enter' });

      expect(component.emitted('update:modelValue')?.[0]).toEqual([-1_000_000]);
    });
  });
});
