import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MasterAudioEffectsModal from '~/components/audio/MasterAudioEffectsModal.vue';

const applyTimelineMock = vi.fn();

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    timelineDoc: { metadata: { fastcat: { masterEffects: [{ id: 'efx-1', type: 'reverb', target: 'audio' }] } } },
    applyTimeline: applyTimelineMock,
  }),
}));

const ClipEffectsEditorStub = {
  props: ['target', 'effects'],
  emits: ['update:effects'],
  template:
    '<div class="editor-stub" :data-target="target"><button class="emit-update" @click="$emit(\'update:effects\', [{ type: \'reverb\', target: \'audio\' }, { type: \'eq\', target: \'video\' }])" /></div>',
};

const UiModalStub = {
  props: ['open', 'title'],
  emits: ['update:open'],
  template: '<div v-if="open" class="ui-modal-mock"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

describe('MasterAudioEffectsModal', () => {
  const stubs = {
    UiModal: UiModalStub,
    ClipEffectsEditor: ClipEffectsEditorStub,
    UButton: {
      props: ['color', 'variant'],
      template: '<button class="u-button"><slot /></button>',
    },
  };

  it('renders modal content when open', async () => {
    const component = await mountSuspended(MasterAudioEffectsModal, {
      props: { open: true },
      global: { stubs },
    });

    expect(component.find('.ui-modal-mock').exists()).toBe(true);
    expect(component.find('.editor-stub').exists()).toBe(true);
  });

  it('does not render modal content when closed', async () => {
    const component = await mountSuspended(MasterAudioEffectsModal, {
      props: { open: false },
      global: { stubs },
    });

    expect(component.find('.ui-modal-mock').exists()).toBe(false);
  });

  it('passes master effects from timeline doc to editor', async () => {
    const component = await mountSuspended(MasterAudioEffectsModal, {
      props: { open: true },
      global: { stubs },
    });

    expect(component.find('.editor-stub').attributes('data-target')).toBe('audio');
  });

  it('filters audio-only effects on update and applies timeline action', async () => {
    applyTimelineMock.mockClear();
    const component = await mountSuspended(MasterAudioEffectsModal, {
      props: { open: true },
      global: { stubs },
    });

    await component.find('.emit-update').trigger('click');

    expect(applyTimelineMock).toHaveBeenCalledWith({
      type: 'update_master_effects',
      effects: [{ type: 'reverb', target: 'audio' }],
    });
  });
});
