/** @vitest-environment happy-dom */
import { defineComponent, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalDragAndDrop } from '~/composables/editor/useGlobalDragAndDrop';

const { draggedFileRef, handleFilesMock, onDragDropEventMock } = vi.hoisted(() => ({
  draggedFileRef: { value: null as unknown },
  handleFilesMock: vi.fn(),
  onDragDropEventMock: vi.fn(),
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    isFileManagerDragging: false,
    isGlobalDragging: false,
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    projectsHandle: {},
    userSettings: {
      hotkeys: {},
    },
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    currentProjectName: 'Project',
  }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    handleFiles: handleFilesMock,
    vfs: {
      getFile: vi.fn(),
    },
  }),
}));

vi.mock('~/composables/useDraggedFile', () => ({
  useDraggedFile: () => ({
    draggedFile: draggedFileRef,
  }),
}));

vi.mock('~/composables/useUploadProgress', () => ({
  useUploadProgress: () => ({
    isActive: { value: false },
    progress: { value: 0 },
    fileName: { value: '' },
    phase: { value: '' },
    begin: vi.fn(() => new AbortController().signal),
    end: vi.fn(),
    cancel: vi.fn(),
    onProgress: vi.fn(),
  }),
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: onDragDropEventMock,
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.stubGlobal('useI18n', () => ({
  t: (key: string) => key,
}));

describe('useGlobalDragAndDrop', () => {
  beforeEach(() => {
    draggedFileRef.value = null;
    handleFilesMock.mockReset();
    onDragDropEventMock.mockReset();
    onDragDropEventMock.mockResolvedValue(vi.fn());
  });

  it('ignores Tauri native drop that belongs to an internal file-manager drag', async () => {
    const component = defineComponent({
      setup() {
        useGlobalDragAndDrop();
        return () => null;
      },
    });

    const wrapper = mount(component);
    await flushPromises();

    const callback = onDragDropEventMock.mock.calls[0]?.[0];
    expect(callback).toBeTypeOf('function');

    const payload = {
      name: 'image.png',
      kind: 'file',
      path: '_images/image.png',
    };
    draggedFileRef.value = payload;

    const dropListener = vi.fn();
    window.addEventListener('fastcat:tauri-internal-file-drop', dropListener);

    await callback({ payload: { type: 'over' } });
    draggedFileRef.value = null;
    await callback({ payload: { type: 'drop', paths: ['/tmp/image.png'], position: { x: 20, y: 40 } } });
    await nextTick();

    expect(handleFilesMock).not.toHaveBeenCalled();
    expect(dropListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          clientX: 20,
          clientY: 40,
          payload,
        },
      }),
    );
    window.removeEventListener('fastcat:tauri-internal-file-drop', dropListener);
    wrapper.unmount();
  });
});
