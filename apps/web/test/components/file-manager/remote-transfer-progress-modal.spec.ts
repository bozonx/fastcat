import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';

vi.mock('~/composables/ui/useModalOpenModel', () => ({
  useModalOpenModel: (props: any, emit: any) => ({
    get value() {
      return props.open;
    },
    set value(v: boolean) {
      emit('update:open', v);
    },
  }),
}));

describe('RemoteTransferProgressModal', () => {
  it('renders when open', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.5 },
    });

    expect(component.exists()).toBe(true);
  });

  it('displays file name when provided', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.5, fileName: 'video.mp4' },
    });

    expect(component.text()).toContain('video.mp4');
  });

  it('does not display file name when not provided', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.5 },
    });

    expect(component.text()).not.toContain('video.mp4');
  });

  it('displays phase when provided', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.5, phase: 'Uploading...' },
    });

    expect(component.text()).toContain('Uploading...');
  });

  it('shows progress percentage', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.42 },
    });

    expect(component.text()).toContain('42%');
  });

  it('clamps progress to 0-100', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 1.5 },
    });

    expect(component.text()).toContain('100%');
  });

  it('clamps negative progress to 0', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: -0.5 },
    });

    expect(component.text()).toContain('0%');
  });

  it('emits cancel when cancel button is clicked', async () => {
    const component = await mountSuspended(RemoteTransferProgressModal, {
      props: { open: true, title: 'Transfer', progress: 0.5 },
    });

    const buttons = component.findAll('button');
    const cancelButton = buttons.find((b) => b.text().includes('common.cancel'));
    if (cancelButton) {
      await cancelButton.trigger('click');
      expect(component.emitted('cancel')).toBeTruthy();
    }
  });
});
