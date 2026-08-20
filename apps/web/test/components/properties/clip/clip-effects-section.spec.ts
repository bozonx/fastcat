import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipEffectsSection from '~/components/properties/clip/ClipEffectsSection.vue';

const ClipEffectsEditorStub = {
  props: [
    'target',
    'effects',
    'keyframes',
    'title',
    'addLabel',
    'emptyLabel',
    'hasToggle',
    'disabled',
    'enabled',
  ],
  emits: ['update:effects', 'update:enabled'],
  template:
    '<div class="editor-mock" :data-target="target" :data-disabled="disabled"><button class="emit-effects" @click="$emit(\'update:effects\', [{ type: target === \'audio\' ? \'reverb\' : \'blur\', target }])" /></div>',
};

describe('ClipEffectsSection', () => {
  const mountSection = (props: Record<string, unknown>) =>
    mountSuspended(ClipEffectsSection, {
      props: props as any,
      global: { stubs: { ClipEffectsEditor: ClipEffectsEditorStub } },
    });

  it('renders video editor by default', async () => {
    const component = await mountSection({ videoEffects: [], audioEffects: [] });

    const editors = component.findAll('.editor-mock');
    expect(editors.length).toBe(1);
    expect(editors[0]!.attributes('data-target')).toBe('video');
  });

  it('renders both video and audio editors when showAudioEffects is true', async () => {
    const component = await mountSection({
      videoEffects: [],
      audioEffects: [],
      showAudioEffects: true,
    });

    const targets = component.findAll('.editor-mock').map((e) => e.attributes('data-target'));
    expect(targets).toContain('video');
    expect(targets).toContain('audio');
  });

  it('hides video editor when showVideoEffects is false', async () => {
    const component = await mountSection({
      videoEffects: [],
      audioEffects: [],
      showVideoEffects: false,
      showAudioEffects: true,
    });

    const targets = component.findAll('.editor-mock').map((e) => e.attributes('data-target'));
    expect(targets).not.toContain('video');
    expect(targets).toContain('audio');
  });

  it('forwards updateVideoEffects on video editor update', async () => {
    const component = await mountSection({ videoEffects: [], audioEffects: [] });

    await component.find('.emit-effects').trigger('click');

    expect(component.emitted('updateVideoEffects')).toBeTruthy();
    expect(component.emitted('updateVideoEffects')![0]).toEqual([
      [{ type: 'blur', target: 'video' }],
    ]);
  });

  it('forwards updateAudioEffects on audio editor update', async () => {
    const component = await mountSection({
      videoEffects: [],
      audioEffects: [],
      showAudioEffects: true,
    });

    const audioEditor = component
      .findAll('.editor-mock')
      .filter((e) => e.attributes('data-target') === 'audio')[0]!;
    await audioEditor.find('.emit-effects').trigger('click');

    expect(component.emitted('updateAudioEffects')).toBeTruthy();
    expect(component.emitted('updateAudioEffects')![0]).toEqual([
      [{ type: 'reverb', target: 'audio' }],
    ]);
  });
});
