import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import FileBrowserModals from '~/components/file-manager/FileBrowserModals.vue';

describe('FileBrowserModals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders delete confirmation modal correctly with one target', () => {
    const wrapper = mount(FileBrowserModals, {
      props: {
        isDeleteConfirmModalOpen: true,
        deleteTargets: [{ name: 'test.mp4', path: 'test.mp4', kind: 'file' }] as any,
        remoteTransferOpen: false,
        remoteTransferProgress: 0,
        remoteTransferPhase: '',
        remoteTransferFileName: '',
        transcriptionModalOpen: false,
        isTranscribing: false,
        transcriptionError: '',
        transcriptionEntry: null,
        transcriptionLanguage: 'en',
      },
      global: {
        stubs: {
          UiConfirmModal: { template: '<div><slot /></div>' },
          UiModal: true,
          UiTextInput: true,
          UiFormField: true,
          RemoteTransferProgressModal: true,
        },
      },
    });

    expect(wrapper.text()).toContain('test.mp4');
  });

  it('renders item count for multiple delete targets', () => {
    const wrapper = mount(FileBrowserModals, {
      props: {
        isDeleteConfirmModalOpen: true,
        deleteTargets: [
          { name: '1.mp4', path: '1.mp4', kind: 'file' },
          { name: '2.mp4', path: '2.mp4', kind: 'file' },
        ] as any,
        remoteTransferOpen: false,
        remoteTransferProgress: 0,
        remoteTransferPhase: '',
        remoteTransferFileName: '',
        transcriptionModalOpen: false,
        isTranscribing: false,
        transcriptionError: '',
        transcriptionEntry: null,
        transcriptionLanguage: 'en',
      },
      global: {
        stubs: {
          UiConfirmModal: { template: '<div><slot /></div>' },
          UiModal: true,
          UiTextInput: true,
          UiFormField: true,
          RemoteTransferProgressModal: true,
        },
      },
    });

    expect(wrapper.text()).toContain('2 items selected');
  });
});
