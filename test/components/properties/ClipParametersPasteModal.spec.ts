import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';
import type { ClipParameterGroupOption } from '~/utils/timeline/clip-parameters';

describe('ClipParametersPasteModal', () => {
  const baseGroups: ClipParameterGroupOption[] = [
    {
      id: 'transform',
      labelKey: 'fastcat.clip.parameters.groups.transform',
      selectedByDefault: true,
    },
    { id: 'opacity', labelKey: 'fastcat.clip.parameters.groups.opacity', selectedByDefault: true },
    { id: 'speed', labelKey: 'fastcat.clip.parameters.groups.speed', selectedByDefault: false },
  ];

  it('renders checkboxes for each group', async () => {
    const isOpen = ref(true);
    const selected = ref<string[]>([]);

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: isOpen.value,
        selectedGroups: selected.value,
        'onUpdate:open': (v: boolean) => {
          isOpen.value = v;
        },
        'onUpdate:selectedGroups': (v: string[]) => {
          selected.value = v;
        },
      },
    });

    await flushPromises();
    expect(document.body.textContent).toContain('fastcat.clip.parameters.groups.transform');
    expect(document.body.textContent).toContain('fastcat.clip.parameters.groups.opacity');
    expect(document.body.textContent).toContain('fastcat.clip.parameters.groups.speed');
  });

  it('disables apply button when no groups are selected', async () => {
    const isOpen = ref(true);
    const selected = ref<string[]>([]);

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: isOpen.value,
        selectedGroups: selected.value,
        'onUpdate:open': (v: boolean) => {
          isOpen.value = v;
        },
        'onUpdate:selectedGroups': (v: string[]) => {
          selected.value = v;
        },
      },
    });

    const applyBtn = wrapper.find('[data-primary-focus="true"]');
    expect(applyBtn.attributes('disabled')).toBeDefined();
  });

  it('emits apply with selected groups when apply is clicked', async () => {
    const isOpen = ref(true);
    const selected = ref<string[]>(['transform']);

    const onApply = vi.fn();

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: isOpen.value,
        selectedGroups: selected.value,
        'onUpdate:open': (v: boolean) => {
          isOpen.value = v;
        },
        'onUpdate:selectedGroups': (v: string[]) => {
          selected.value = v;
        },
        onApply,
      },
    });

    const applyBtn = wrapper.find('[data-primary-focus="true"]');
    await applyBtn.trigger('click');

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(['transform']);
    expect(isOpen.value).toBe(false);
  });

  it('shows no applicable groups message when groups array is empty', async () => {
    const isOpen = ref(true);
    const selected = ref<string[]>([]);

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: [],
        open: isOpen.value,
        selectedGroups: selected.value,
        'onUpdate:open': (v: boolean) => {
          isOpen.value = v;
        },
        'onUpdate:selectedGroups': (v: string[]) => {
          selected.value = v;
        },
      },
    });

    await flushPromises();
    expect(document.body.textContent).toContain('fastcat.clip.parameters.noApplicableGroups');
  });
});
