import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EffectCard from '~/components/effects/EffectCard.vue';

const sampleManifest = {
  id: 'blur',
  name: 'Blur',
  nameKey: 'effects.blur.name',
  description: 'Applies a blur effect',
  descriptionKey: 'effects.blur.description',
  icon: 'i-heroicons-sparkles',
  target: 'audio',
  params: {},
} as any;

describe('EffectCard', () => {
  it('renders effect name from manifest', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest },
    });

    expect(component.text()).toContain('effects.blur.name');
  });

  it('renders effect name from nameKey when provided', async () => {
    const manifest = { ...sampleManifest, nameKey: undefined };
    const component = await mountSuspended(EffectCard, {
      props: { manifest },
    });

    expect(component.text()).toContain('Blur');
  });

  it('renders description when provided', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest },
    });

    expect(component.text()).toContain('effects.blur.description');
  });

  it('emits click when card is clicked', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest },
    });

    const card = component.find('.effect-card');
    await card.trigger('click');

    expect(component.emitted('click')).toBeTruthy();
  });

  it('applies selected styling when isSelected is true', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, isSelected: true },
    });

    const card = component.find('.effect-card');
    expect(card.classes()).toContain('border-primary');
  });

  it('applies draggable cursor when isDraggable is true', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, isDraggable: true },
    });

    const card = component.find('.effect-card');
    expect(card.classes()).toContain('cursor-grab');
  });

  it('emits pointer-down when pressed and isDraggable', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, isDraggable: true },
    });

    const card = component.find('.effect-card');
    await card.trigger('pointerdown');

    expect(component.emitted('pointer-down')).toBeTruthy();
  });

  it('does not emit pointer-down when not draggable', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, isDraggable: false },
    });

    const card = component.find('.effect-card');
    await card.trigger('pointerdown');

    expect(component.emitted('pointer-down')).toBeFalsy();
  });

  it('shows action button when showAction is true', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, showAction: true },
    });

    expect(component.findAll('button').length).toBeGreaterThanOrEqual(1);
  });

  it('emits action when action button is clicked', async () => {
    const component = await mountSuspended(EffectCard, {
      props: { manifest: sampleManifest, showAction: true },
    });

    const actionBtn = component.find('button');
    await actionBtn.trigger('click');

    expect(component.emitted('action')).toBeTruthy();
  });
});
