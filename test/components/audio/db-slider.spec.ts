import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import DbSlider from '~/components/audio/DbSlider.vue';

vi.mock('~/utils/audio', () => ({
  getAudioMeterColorClass: (db: number) => (db > 0 ? 'bg-red-500' : 'bg-green-500'),
  getAudioMeterPercent: (db: number, min: number, max: number) => {
    const clamped = Math.max(min, Math.min(max, db));
    return ((clamped - min) / (max - min)) * 100;
  },
  isAudioClipping: (db: number) => db > 0,
  dbToPercent: (db: number, min: number, max: number) => {
    const clamped = Math.max(min, Math.min(max, db));
    return ((clamped - min) / (max - min)) * 100;
  },
  percentToDb: (percent: number, min: number, max: number) => {
    return min + (percent / 100) * (max - min);
  },
}));

vi.mock('~/utils/browser-api', () => ({
  addDocumentEventListener: vi.fn(),
  removeDocumentEventListener: vi.fn(),
}));

describe('DbSlider', () => {
  it('renders slider with role', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    expect(component.find('[role="slider"]').exists()).toBe(true);
  });

  it('renders tick marks', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const ticks = component.findAll('.text-3xs');
    expect(ticks.length).toBe(9);
  });

  it('emits update:modelValue with 0 on double click', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: -6 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('dblclick');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual([0]);
  });

  it('emits update:modelValue on ArrowUp keydown', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('keydown', { key: 'ArrowUp' });

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual([1]);
  });

  it('emits update:modelValue on ArrowDown keydown', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('keydown', { key: 'ArrowDown' });

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')![0]).toEqual([-1]);
  });

  it('emits update:modelValue on Home key (min)', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('keydown', { key: 'Home' });

    expect(component.emitted('update:modelValue')![0]).toEqual([-60]);
  });

  it('emits update:modelValue on End key (max)', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('keydown', { key: 'End' });

    expect(component.emitted('update:modelValue')![0]).toEqual([12]);
  });

  it('emits update:modelValue on Enter key (reset to 0)', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: -6 },
    });

    const slider = component.find('[role="slider"]');
    await slider.trigger('keydown', { key: 'Enter' });

    expect(component.emitted('update:modelValue')![0]).toEqual([0]);
  });

  it('renders clipping indicator', async () => {
    const component = await mountSuspended(DbSlider, {
      props: { modelValue: 0 },
    });

    const clipIndicator = component.find('.cursor-pointer');
    expect(clipIndicator.exists()).toBe(true);
  });
});
