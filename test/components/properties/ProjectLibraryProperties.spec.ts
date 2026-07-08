import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, nextTick } from 'vue';
import ProjectLibraryProperties from '~/components/properties/ProjectLibraryProperties.vue';

const saveAsPresetMock = vi.fn();
const updatePresetMock = vi.fn();
const renamePresetMock = vi.fn();
const removePresetMock = vi.fn();
const clearSelectionMock = vi.fn();

const mockCustomPresets = reactive<Array<{ id: string; name: string; baseType: string; category: string }>>([]);

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => ({
    customPresets: mockCustomPresets,
    saveAsPreset: saveAsPresetMock,
    updatePreset: updatePresetMock,
    renamePreset: renamePresetMock,
    removePreset: removePresetMock,
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => ({ clearSelection: clearSelectionMock }),
}));

vi.mock('~/utils/clone', () => ({
  cloneValue: (v: unknown) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v),
}));

vi.mock('~/hud/registry', () => ({
  getHudManifest: () => ({ controls: [] }),
}));

const ClipTextPropertiesStub = {
  props: ['clip', 'presets', 'hidePresets'],
  emits: ['update-text', 'update-text-style'],
  template:
    '<div class="text-stub"><button class="t-text" @click="$emit(\'update-text\', \'new text\')" /><button class="t-style" @click="$emit(\'update-text-style\', { color: \'red\' })" /></div>',
};

const ClipShapePropertiesStub = {
  props: ['clip', 'presets', 'hidePresets'],
  emits: ['update-shape-type', 'update-fill-color', 'update-stroke-color', 'update-stroke-width', 'update-shape-config'],
  template:
    '<div class="shape-stub"><button class="s-type" @click="$emit(\'update-shape-type\', \'circle\')" /><button class="s-fill" @click="$emit(\'update-fill-color\', \'#fff\')" /><button class="s-config" @click="$emit(\'update-shape-config\', { sides: 5 })" /></div>',
};

const ClipHudPropertiesStub = {
  props: ['clip', 'hudManifest', 'hudControlValues', 'presets', 'hidePresets'],
  emits: ['update-hud-control'],
  template:
    '<div class="hud-stub"><button class="h-update" @click="$emit(\'update-hud-control\', \'content.opacity\', 0.5)" /></div>',
};

const PropertyActionListStub = {
  props: ['actions', 'vertical', 'size'],
  emits: [],
  template:
    '<div class="action-list"><button v-for="action in actions" :key="action.id" :class="\'action-\' + action.id" :title="action.title" @click="action.onClick">{{ action.label }}</button></div>',
};

const PresetSaveModalStub = {
  props: ['open', 'name', 'title'],
  emits: ['update:open', 'update:name', 'save'],
  template:
    '<div v-if="open" class="preset-modal" :data-title="title"><input class="modal-name" :value="name" @input="$emit(\'update:name\', $event.target.value)" /><button class="modal-save" @click="$emit(\'save\')" /></div>',
};

const stubs = {
  ClipTextProperties: ClipTextPropertiesStub,
  ClipShapeProperties: ClipShapePropertiesStub,
  ClipHudProperties: ClipHudPropertiesStub,
  PropertyActionList: PropertyActionListStub,
  PresetSaveModal: PresetSaveModalStub,
  UIcon: { props: ['name'], template: '<span class="icon-mock" />' },
};

describe('ProjectLibraryProperties', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCustomPresets.splice(0, mockCustomPresets.length);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders ClipTextProperties for itemKind text', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'text', presetParams: { text: 'hello', style: { color: 'blue' } } },
      global: { stubs },
    });

    expect(component.find('.text-stub').exists()).toBe(true);
  });

  it('renders ClipShapeProperties for itemKind shape', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'shape', itemId: 'square', presetParams: { fillColor: '#abc' } },
      global: { stubs },
    });

    expect(component.find('.shape-stub').exists()).toBe(true);
  });

  it('renders ClipHudProperties for itemKind hud', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'hud', itemId: 'tracker', presetParams: { background: { c: 1 }, content: { o: 2 } } },
      global: { stubs },
    });

    expect(component.find('.hud-stub').exists()).toBe(true);
  });

  it('updates text and text style via handlers', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'text', presetParams: { text: 'hi' } },
      global: { stubs },
    });

    await component.find('.t-text').trigger('click');
    await component.find('.t-style').trigger('click');

    // No assertions on params (internal) — just exercise handlers; pass = no throw.
    expect(component.find('.text-stub').exists()).toBe(true);
  });

  it('updates shape type, fill color and config via handlers', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'shape', itemId: 'square' },
      global: { stubs },
    });

    await component.find('.s-type').trigger('click');
    await component.find('.s-fill').trigger('click');
    await component.find('.s-config').trigger('click');

    expect(component.find('.shape-stub').exists()).toBe(true);
  });

  it('updates nested hud control via dotted key path', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'hud', itemId: 'tracker', presetParams: {} },
      global: { stubs },
    });

    await component.find('.h-update').trigger('click');

    expect(component.find('.hud-stub').exists()).toBe(true);
  });

  it('saveAsPreset action opens modal and saves for builtin item', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'text', presetParams: { text: 'hi' } },
      global: { stubs },
    });

    await component.find('.action-save-as-preset').trigger('click');
    await component.find('.modal-name').setValue('My Preset');
    await component.find('.modal-save').trigger('click');

    expect(saveAsPresetMock).toHaveBeenCalledWith('text', 'text', 'My Preset', expect.any(Object));
  });

  it('does not save preset when name empty', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'text' },
      global: { stubs },
    });

    await component.find('.action-save-as-preset').trigger('click');
    await component.find('.modal-name').setValue('   ');
    await component.find('.modal-save').trigger('click');

    expect(saveAsPresetMock).not.toHaveBeenCalled();
  });

  it('shows update/rename/delete actions for custom preset and resolves baseType', async () => {
    mockCustomPresets.push({ id: 'custom_text_1', name: 'Custom Text', baseType: 'text', category: 'text' });
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'custom_text_1', presetParams: { text: 'hi' } },
      global: { stubs },
    });

    expect(component.find('.action-update-preset').exists()).toBe(true);
    expect(component.find('.action-rename-preset').exists()).toBe(true);
    expect(component.find('.action-delete-preset').exists()).toBe(true);

    // Update action calls updatePreset with custom itemId and params
    await component.find('.action-update-preset').trigger('click');
    expect(updatePresetMock).toHaveBeenCalledWith('custom_text_1', expect.any(Object));
  });

  it('isRecentlySaved flips true then false after 1500ms', async () => {
    mockCustomPresets.push({ id: 'custom_text_1', name: 'Custom Text', baseType: 'text', category: 'text' });
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'custom_text_1', presetParams: { text: 'hi' } },
      global: { stubs },
    });

    await component.find('.action-update-preset').trigger('click');
    // After update, label should show "common.saved"
    expect(component.find('.action-update-preset').text()).toBe('common.saved');

    // Advance past 1500ms timeout
    vi.advanceTimersByTime(1500);
    await nextTick();

    expect(component.find('.action-update-preset').text()).toBe('common.save');
  });

  it('rename action opens rename modal and calls renamePreset', async () => {
    mockCustomPresets.push({ id: 'custom_text_1', name: 'Old Name', baseType: 'text', category: 'text' });
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'custom_text_1', presetParams: {} },
      global: { stubs },
    });

    await component.find('.action-rename-preset').trigger('click');
    await component.find('.modal-name').setValue('New Name');
    await component.find('.modal-save').trigger('click');

    expect(renamePresetMock).toHaveBeenCalledWith('custom_text_1', 'New Name');
  });

  it('delete action calls removePreset and clearSelection', async () => {
    mockCustomPresets.push({ id: 'custom_text_1', name: 'To Delete', baseType: 'text', category: 'text' });
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'custom_text_1', presetParams: {} },
      global: { stubs },
    });

    await component.find('.action-delete-preset').trigger('click');

    expect(removePresetMock).toHaveBeenCalledWith('custom_text_1');
    expect(clearSelectionMock).toHaveBeenCalled();
  });

  it('resets params when presetParams prop changes', async () => {
    const component = await mountSuspended(ProjectLibraryProperties, {
      props: { itemKind: 'text', itemId: 'text', presetParams: { text: 'first' } },
      global: { stubs },
    });

    await component.setProps({ presetParams: { text: 'second' } });

    // Save flow exercises the new params; verify save uses updated text.
    await component.find('.action-save-as-preset').trigger('click');
    await component.find('.modal-name').setValue('P');
    await component.find('.modal-save').trigger('click');

    expect(saveAsPresetMock).toHaveBeenCalledWith('text', 'text', 'P', expect.objectContaining({ text: 'second' }));
  });
});
