import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TransitionParamFields from '~/components/properties/TransitionParamFields.vue';

vi.mock('~/components/properties/ParamsRenderer.vue', () => ({
  default: {
    props: ['controls', 'values', 'size'],
    emits: ['update:value'],
    template:
      '<div class="params-mock" :data-size="size"><button class="emit-update" @click="$emit(\'update:value\', \'amount\', 50)" /></div>',
  },
}));

describe('TransitionParamFields', () => {
  it('renders params renderer with fields and params', async () => {
    const component = await mountSuspended(TransitionParamFields, {
      props: {
        fields: [{ kind: 'slider', key: 'amount', labelKey: 'amount' } as any],
        params: { amount: 25 },
      },
    });

    expect(component.find('.params-mock').exists()).toBe(true);
  });

  it('forwards update:param when value emitted', async () => {
    const component = await mountSuspended(TransitionParamFields, {
      props: {
        fields: [{ kind: 'slider', key: 'amount' } as any],
        params: { amount: 25 },
      },
    });

    await component.find('.emit-update').trigger('click');

    expect(component.emitted('update:param')).toBeTruthy();
    expect(component.emitted('update:param')![0]).toEqual(['amount', 50]);
  });
});
