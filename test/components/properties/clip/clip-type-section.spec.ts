import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineClipItem } from '~/timeline/types';
import ClipTypeSection from '~/components/properties/clip/ClipTypeSection.vue';

const mockSaveAsPreset = vi.fn();
const mockCustomPresets = [
  {
    id: 'preset-text-1',
    category: 'text',
    name: 'Text Preset',
    params: { style: { color: 'red' } },
  },
  {
    id: 'preset-shape-1',
    category: 'shape',
    name: 'Shape Preset',
    params: {
      shapeType: 'circle',
      fillColor: '#fff',
      strokeColor: '#000',
      strokeWidth: 2,
      shapeConfig: { sides: 5 },
    },
  },
  {
    id: 'preset-hud-1',
    category: 'hud',
    name: 'HUD Preset',
    params: { background: { color: 'blue' }, content: { opacity: 0.5 } },
  },
];

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => ({
    customPresets: mockCustomPresets,
    saveAsPreset: mockSaveAsPreset,
  }),
}));

// Stub PresetSaveModal so we can drive save flow without the real modal.
const PresetSaveModalStub = {
  props: ['open', 'name'],
  emits: ['update:open', 'update:name', 'save'],
  template:
    '<div v-if="open" class="preset-save-mock"><input class="preset-name" :value="name" @input="$emit(\'update:name\', $event.target.value)" /><button class="preset-confirm" @click="$emit(\'save\')" /></div>',
};

const ClipTextPropertiesStub = {
  props: ['clip', 'presets'],
  emits: [
    'update-text',
    'update-text-style',
    'update-snap-to-pixel-grid',
    'load-preset',
    'save-preset',
  ],
  template:
    '<div class="text-stub" :data-presets="presets.length"><button class="t-style" @click="$emit(\'update-text-style\', { color: \'red\' })" /><button class="t-save" @click="$emit(\'save-preset\')" /></div>',
};

const ClipShapePropertiesStub = {
  props: ['clip', 'presets'],
  emits: [
    'update-shape-type',
    'update-fill-color',
    'update-stroke-color',
    'update-stroke-width',
    'update-shape-config',
    'update-snap-to-pixel-grid',
    'load-preset',
    'save-preset',
  ],
  template:
    '<div class="shape-stub"><button class="s-type" @click="$emit(\'update-shape-type\', \'circle\')" /><button class="s-save" @click="$emit(\'save-preset\')" /></div>',
};

const ClipHudPropertiesStub = {
  props: ['clip', 'hudManifest', 'hudControlValues', 'presets'],
  emits: ['update-hud-control', 'load-preset', 'save-preset'],
  template:
    '<div class="hud-stub"><button class="h-update" @click="$emit(\'update-hud-control\', \'content.opacity\', 0.5)" /><button class="h-save" @click="$emit(\'save-preset\')" /></div>',
};

function createClip(clipType: string, overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType,
    id: 'clip-1',
    trackId: 'track-1',
    name: 'My Clip',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('ClipTypeSection', () => {
  const stubs = {
    PresetSaveModal: PresetSaveModalStub,
    ClipTextProperties: ClipTextPropertiesStub,
    ClipShapeProperties: ClipShapePropertiesStub,
    ClipHudProperties: ClipHudPropertiesStub,
  };

  it('renders ClipTextProperties when clipType is text', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: { clip: createClip('text'), hudManifest: null, hudControlValues: {} },
      global: { stubs },
    });

    expect(component.find('.text-stub').exists()).toBe(true);
    expect(component.find('.shape-stub').exists()).toBe(false);
  });

  it('passes text presets to ClipTextProperties', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: { clip: createClip('text'), hudManifest: null, hudControlValues: {} },
      global: { stubs },
    });

    expect(component.find('.text-stub').attributes('data-presets')).toBe('1');
  });

  it('renders ClipShapeProperties when clipType is shape', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: { clip: createClip('shape'), hudManifest: null, hudControlValues: {} },
      global: { stubs },
    });

    expect(component.find('.shape-stub').exists()).toBe(true);
    expect(component.find('.text-stub').exists()).toBe(false);
  });

  it('renders ClipHudProperties when clipType is hud and hudFeatureEnabled', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('hud'),
        hudManifest: { controls: [] },
        hudControlValues: {},
        hudFeatureEnabled: true,
      },
      global: { stubs },
    });

    expect(component.find('.hud-stub').exists()).toBe(true);
  });

  it('does not render ClipHudProperties when hudFeatureEnabled is false', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('hud'),
        hudManifest: null,
        hudControlValues: {},
        hudFeatureEnabled: false,
      },
      global: { stubs },
    });

    expect(component.find('.hud-stub').exists()).toBe(false);
  });

  it('forwards updateTextStyle from text properties', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: { clip: createClip('text'), hudManifest: null, hudControlValues: {} },
      global: { stubs },
    });

    await component.find('.t-style').trigger('click');

    expect(component.emitted('updateTextStyle')).toBeTruthy();
    expect(component.emitted('updateTextStyle')![0]).toEqual([{ color: 'red' }]);
  });

  it('forwards shape update events', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: { clip: createClip('shape'), hudManifest: null, hudControlValues: {} },
      global: { stubs },
    });

    await component.find('.s-type').trigger('click');

    expect(component.emitted('updateShapeType')).toBeTruthy();
    expect(component.emitted('updateShapeType')![0]).toEqual(['circle']);
  });

  it('forwards updateHudControl from hud properties', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('hud'),
        hudManifest: { controls: [] },
        hudControlValues: {},
        hudFeatureEnabled: true,
      },
      global: { stubs },
    });

    await component.find('.h-update').trigger('click');

    expect(component.emitted('updateHudControl')).toBeTruthy();
    expect(component.emitted('updateHudControl')![0]).toEqual(['content.opacity', 0.5]);
  });

  it('opens save modal with clip name and saves text preset', async () => {
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('text', { style: { color: 'red' } } as any),
        hudManifest: null,
        hudControlValues: {},
      },
      global: { stubs },
    });

    await component.find('.t-save').trigger('click');
    await component.find('.preset-confirm').trigger('click');

    expect(mockSaveAsPreset).toHaveBeenCalledWith('text', 'custom', 'My Clip', {
      style: { color: 'red' },
      text: undefined,
    });
  });

  it('saves shape preset with shape params', async () => {
    mockSaveAsPreset.mockClear();
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('shape', {
          shapeType: 'square',
          fillColor: '#abc',
          strokeColor: '#def',
          strokeWidth: 3,
          shapeConfig: { sides: 4 },
        } as any),
        hudManifest: null,
        hudControlValues: {},
      },
      global: { stubs },
    });

    await component.find('.s-save').trigger('click');
    await component.find('.preset-confirm').trigger('click');

    expect(mockSaveAsPreset).toHaveBeenCalledWith('shape', 'square', 'My Clip', {
      shapeType: 'square',
      fillColor: '#abc',
      strokeColor: '#def',
      strokeWidth: 3,
      shapeConfig: { sides: 4 },
    });
  });

  it('saves hud preset with hud params', async () => {
    mockSaveAsPreset.mockClear();
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('hud', {
          hudType: 'tracker',
          background: { c: 1 },
          content: { o: 2 },
          frame: { f: 3 },
        } as any),
        hudManifest: { controls: [] },
        hudControlValues: {},
        hudFeatureEnabled: true,
      },
      global: { stubs },
    });

    await component.find('.h-save').trigger('click');
    await component.find('.preset-confirm').trigger('click');

    expect(mockSaveAsPreset).toHaveBeenCalledWith('hud', 'tracker', 'My Clip', {
      hudType: 'tracker',
      background: { c: 1 },
      content: { o: 2 },
      frame: { f: 3 },
    });
  });

  it('does not save preset when name is empty', async () => {
    mockSaveAsPreset.mockClear();
    const component = await mountSuspended(ClipTypeSection, {
      props: {
        clip: createClip('text', { name: '   ' } as any),
        hudManifest: null,
        hudControlValues: {},
      },
      global: { stubs },
    });

    await component.find('.t-save').trigger('click');
    // Clear the name via stub input
    await component.find('.preset-name').setValue('');
    await component.find('.preset-confirm').trigger('click');

    expect(mockSaveAsPreset).not.toHaveBeenCalled();
  });
});
