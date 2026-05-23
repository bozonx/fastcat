/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useBlurOnPointerDownOutside } from '~/composables/useBlurOnPointerDownOutside';

describe('useBlurOnPointerDownOutside', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mountTestComponent(tag: 'input' | 'textarea' = 'input') {
    const containerRef = ref<HTMLElement | null>(null);

    const TestComp = defineComponent({
      setup() {
        useBlurOnPointerDownOutside(containerRef);
        return () => h('div', { ref: containerRef }, [h(tag)]);
      },
    });

    const wrapper = mount(TestComp, { attachTo: document.body });
    const focusable = containerRef.value!.querySelector(tag) as HTMLElement;
    return { containerRef, focusable, wrapper };
  }

  it('blurs focused input when pointerdown occurs outside the container', () => {
    const { focusable } = mountTestComponent();
    focusable.focus();
    expect(document.activeElement).toBe(focusable);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.activeElement).not.toBe(focusable);
    outside.remove();
  });

  it('blurs focused textarea when pointerdown occurs outside the container', () => {
    const { focusable } = mountTestComponent('textarea');
    focusable.focus();
    expect(document.activeElement).toBe(focusable);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.activeElement).not.toBe(focusable);
    outside.remove();
  });

  it('does not blur when pointerdown occurs inside the container', () => {
    const { focusable } = mountTestComponent();
    focusable.focus();
    expect(document.activeElement).toBe(focusable);

    focusable.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.activeElement).toBe(focusable);
  });

  it('does nothing when the focusable element is not focused', () => {
    const { focusable } = mountTestComponent();
    expect(document.activeElement).not.toBe(focusable);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.activeElement).not.toBe(focusable);
    outside.remove();
  });
});
