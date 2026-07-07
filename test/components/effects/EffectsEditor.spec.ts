import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipEffectsEditor from '~/components/effects/ClipEffectsEditor';
import { clearDndZones, DND_ZONE_ATTR, getDndZone } from '~/composables/dnd/dndRegistry';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';

vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    template: '<div class="mock-draggable"><slot /></div>',
    props: ['modelValue'],
  },
}));

vi.mock('~/components/effects/SelectEffectModal.vue', () => ({
  default: { template: '<div class="mock-select-effect"></div>', props: ['open'] },
}));
vi.mock('~/components/effects/EffectSettingsModal.vue', () => ({
  default: { template: '<div class="mock-effect-settings"></div>' },
}));
vi.mock('~/components/properties/ParamsRenderer.vue', () => ({
  default: { template: '<div class="mock-params-renderer"></div>' },
}));
vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    template: '<div class="mock-modal"><slot name="body" /><slot /></div>',
    props: ['open'],
  },
}));

const mockPresetsStore = {
  saveAsPreset: vi.fn(),
};

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

vi.mock('~/effects', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getVideoEffectManifest: (type: string) => {
      if (type === 'blur')
        return { name: 'Blur Effect', type: 'blur', defaultValues: { radius: 5 }, controls: [] };
      return null;
    },
    getAudioEffectManifest: () => null,
  };
});

describe('ClipEffectsEditor (video target)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDndZones();
  });

  const sampleEffects = [
    { id: 'eff-1', type: 'blur', target: 'video', enabled: true, radius: 10 } as any,
  ];

  it('renders correctly with empty effects', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: [] },
    });

    expect(component.text()).toContain('fastcat.effects.empty');
  });

  it('renders correctly with effects', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: sampleEffects },
    });

    expect(component.text()).toContain('Blur Effect');
    const toggle = component.findComponent({ name: 'USwitch' });
    expect(toggle.exists()).toBe(true);
  });

  it('emits disabled effects when the section toggle is turned off', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: sampleEffects, hasToggle: true, enabled: true },
    });

    await component.setProps({ enabled: false });

    expect(component.emitted('update:effects')?.[0][0]).toEqual([
      {
        ...sampleEffects[0],
        enabled: false,
      },
    ]);
  });

  it('emits update:effects when removing an effect', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: sampleEffects },
    });

    const buttons = component.findAllComponents({ name: 'UButton' });
    const trashBtn = buttons.find(
      (b) => b.props('icon') === 'i-heroicons-trash' || b.props('color') === 'red',
    );

    if (trashBtn) {
      trashBtn.vm.$emit('click');
    } else {
      // Fallback to DOM button if UButton is rendered directly
      const domBtns = component.findAll('button');
      const domTrashBtn = domBtns.find((b) => b.html().includes('trash'));
      await domTrashBtn!.trigger('click');
    }

    expect(component.emitted('update:effects')).toBeTruthy();
    expect(component.emitted('update:effects')![0][0]).toEqual([]);
  });

  it('adds an effect from a pointer-DnD drop into clip properties', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: [] },
    });
    const zoneId = component.find(`[${DND_ZONE_ATTR}]`).attributes(DND_ZONE_ATTR);
    const handlers = getDndZone(zoneId!);
    const payload: DndPayload = { source: 'effect', data: { type: 'blur' } };

    expect(handlers?.canAccept?.(payload)).toBe(true);

    await handlers?.onDrop?.({
      payload,
      pointer: {
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      zoneId: zoneId!,
      targetEl: null,
      setOperation: vi.fn(),
    } satisfies DndDragContext);

    expect(component.emitted('update:effects')?.[0][0]).toEqual([
      expect.objectContaining({
        type: 'blur',
        enabled: true,
        target: 'video',
        radius: 5,
      }),
    ]);
  });

  it('appends an effect from a pointer-DnD drop after existing effects', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: sampleEffects },
    });
    const zoneId = component.find(`[${DND_ZONE_ATTR}]`).attributes(DND_ZONE_ATTR);
    const handlers = getDndZone(zoneId!);
    const payload: DndPayload = { source: 'effect', data: { type: 'blur' } };

    await handlers?.onDrop?.({
      payload,
      pointer: {
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      zoneId: zoneId!,
      targetEl: null,
      setOperation: vi.fn(),
    } satisfies DndDragContext);

    expect(component.emitted('update:effects')?.[0][0]).toEqual([
      sampleEffects[0],
      expect.objectContaining({
        type: 'blur',
        enabled: true,
        target: 'video',
        radius: 5,
      }),
    ]);
  });

  it('rejects pointer-DnD drops when the editor is disabled', async () => {
    const component = await mountSuspended(ClipEffectsEditor, {
      props: { target: 'video', effects: [], disabled: true },
    });
    const zoneId = component.find(`[${DND_ZONE_ATTR}]`).attributes(DND_ZONE_ATTR);
    const handlers = getDndZone(zoneId!);
    const payload: DndPayload = { source: 'effect', data: { type: 'blur' } };

    expect(handlers?.canAccept?.(payload)).toBe(false);

    await handlers?.onDrop?.({
      payload,
      pointer: {
        clientX: 0,
        clientY: 0,
        pointerType: 'mouse',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
      zoneId: zoneId!,
      targetEl: null,
      setOperation: vi.fn(),
    } satisfies DndDragContext);

    expect(component.emitted('update:effects')).toBeUndefined();
  });
});
