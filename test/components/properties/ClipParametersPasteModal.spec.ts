import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
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

  it('initializes selectedGroups with groups that are selectedByDefault when opened', async () => {
    const selected = ref<string[]>([]);

    await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: true,
        selectedGroups: selected.value,
        'onUpdate:selectedGroups': (v: string[]) => {
          selected.value = v;
        },
      },
    });

    expect(selected.value).toContain('transform');
    expect(selected.value).toContain('opacity');
    expect(selected.value).not.toContain('speed');
  });

  it('disables apply button when no groups are selected', async () => {
    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: [
          {
            id: 'speed',
            labelKey: 'fastcat.clip.parameters.groups.speed',
            selectedByDefault: false,
          },
        ],
        open: true,
        selectedGroups: [],
      },
    });

    const applyBtn = wrapper.find('[data-primary-focus="true"]');
    expect(applyBtn.attributes('disabled')).toBeDefined();
  });

  it('emits apply with selected groups when apply is clicked', async () => {
    const onApply = vi.fn();

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: true,
        selectedGroups: [],
        onApply,
      },
    });

    const applyBtn = wrapper.find('[data-primary-focus="true"]');
    await applyBtn.trigger('click');

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(['transform', 'opacity']);
  });

  it('closes modal on cancel click', async () => {
    const isOpen = ref(true);

    const wrapper = await mountSuspended(ClipParametersPasteModal, {
      props: {
        groups: baseGroups,
        open: isOpen.value,
        selectedGroups: ['transform'],
        'onUpdate:open': (v: boolean) => {
          isOpen.value = v;
        },
      },
    });

    const cancelBtn = wrapper.find('button[data-testid="modal-cancel"]');
    if (cancelBtn.exists()) {
      await cancelBtn.trigger('click');
    } else {
      // Fallback: trigger click on the first neutral ghost button (Cancel)
      const btn = wrapper.findAll('button').find((b) => b.text().includes('common.cancel'));
      expect(btn).toBeDefined();
      await btn!.trigger('click');
    }

    expect(isOpen.value).toBe(false);
  });
});
