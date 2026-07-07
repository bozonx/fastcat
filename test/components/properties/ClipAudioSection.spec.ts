import { describe, expect, it } from 'vitest';
import { ref, nextTick } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import ClipAudioSection from '~/components/properties/clip/ClipAudioSection.vue';
import DbSlider from '~/components/audio/DbSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';

const TestHostDisabled = {
  components: { ClipAudioSection },
  template: `
    <ClipAudioSection
      v-model:enabled="enabled"
      :can-edit-audio-fades="true"
      :can-edit-audio-balance="true"
      :can-edit-audio-gain="true"
      selected-track-kind="audio"
      :audio-gain="1.0"
      :audio-balance="0.0"
      :audio-fade-in-sec="1.0"
      :audio-fade-out-sec="1.0"
      :audio-fade-in-max-sec="5.0"
      :audio-fade-out-max-sec="5.0"
      audio-fade-in-curve="linear"
      audio-fade-out-curve="linear"
    />
  `,
  setup() {
    const enabled = ref(false);
    return {
      enabled,
    };
  },
};

const TestHostEnabled = {
  components: { ClipAudioSection },
  template: `
    <ClipAudioSection
      v-model:enabled="enabled"
      :can-edit-audio-fades="true"
      :can-edit-audio-balance="true"
      :can-edit-audio-gain="true"
      selected-track-kind="audio"
      :audio-gain="1.0"
      :audio-balance="0.0"
      :audio-fade-in-sec="1.0"
      :audio-fade-out-sec="1.0"
      :audio-fade-in-max-sec="5.0"
      :audio-fade-out-max-sec="5.0"
      audio-fade-in-curve="linear"
      audio-fade-out-curve="linear"
    />
  `,
  setup() {
    const enabled = ref(true);
    return {
      enabled,
    };
  },
};

function createAudioSectionProps() {
  return {
    enabled: true,
    canEditAudioFades: true,
    canEditAudioBalance: true,
    canEditAudioGain: true,
    selectedTrackKind: 'audio' as const,
    audioGain: 0.5,
    audioBalance: 0.4,
    audioFadeInSec: 1.2,
    audioFadeOutSec: 1.4,
    audioFadeInMaxSec: 5,
    audioFadeOutMaxSec: 5,
    audioFadeInCurve: 'logarithmic' as const,
    audioFadeOutCurve: 'logarithmic' as const,
  };
}

describe('ClipAudioSection', () => {
  it('keeps audio parameter values when toggled off', async () => {
    const wrapper = await mountWithNuxt(ClipAudioSection, {
      props: createAudioSectionProps(),
    });

    await wrapper.setProps({ enabled: false });

    expect(wrapper.emitted('updateAudioBalance')).toBeUndefined();
    expect(wrapper.emitted('updateAudioFadeInSec')).toBeUndefined();
    expect(wrapper.emitted('updateAudioFadeOutSec')).toBeUndefined();
    expect(wrapper.emitted('updateAudioGain')).toBeUndefined();
  });

  it('keeps volume and balance enabled when fades are toggled off', async () => {
    const host = await mountWithNuxt(TestHostDisabled);

    await nextTick();
    const section = host.findComponent(ClipAudioSection);

    const fadeInputs = section.findAllComponents(UiWheelNumberInput);
    expect(fadeInputs.length).toBeGreaterThanOrEqual(3);
    expect(fadeInputs[0]?.props('disabled')).toBe(false);
    expect(fadeInputs[1]?.props('disabled')).toBe(true);
    expect(fadeInputs[2]?.props('disabled')).toBe(true);

    const balanceInput = section.findComponent(UiSliderInput);
    expect(balanceInput.exists()).toBe(true);
    expect(balanceInput.props('disabled')).toBeFalsy();

    const dbSliderInput = section.findComponent(DbSlider);
    expect(dbSliderInput.exists()).toBe(true);
    expect(dbSliderInput.props('disabled')).toBeFalsy();
  });

  it('keeps all controls enabled when fades are toggled on', async () => {
    const host = await mountWithNuxt(TestHostEnabled);

    await nextTick();
    const section = host.findComponent(ClipAudioSection);

    const fadeInputs = section.findAllComponents(UiWheelNumberInput);
    expect(fadeInputs.length).toBeGreaterThanOrEqual(3);
    expect(fadeInputs[0]?.props('disabled')).toBeFalsy();
    expect(fadeInputs[1]?.props('disabled')).toBeFalsy();
    expect(fadeInputs[2]?.props('disabled')).toBeFalsy();

    const balanceInput = section.findComponent(UiSliderInput);
    expect(balanceInput.props('disabled')).toBeFalsy();

    const dbSliderInput = section.findComponent(DbSlider);
    expect(dbSliderInput.props('disabled')).toBeFalsy();
  });
});
