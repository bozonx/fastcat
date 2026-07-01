/** @vitest-environment happy-dom */
import { defineComponent, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalDragAndDrop } from '~/composables/editor/useGlobalDragAndDrop';

const { draggedFileRef, handleFilesMock, onDragDropEventMock, uiStoreMock, toastAddMock } =
  vi.hoisted(() => ({
    draggedFileRef: { value: null as unknown },
    handleFilesMock: vi.fn(),
    onDragDropEventMock: vi.fn(),
    uiStoreMock: {
      isFileManagerDragging: false,
      isGlobalDragging: false,
    },
    toastAddMock: vi.fn(),
  }));

vi.mock('#ui/composables/useToast', () => ({
  useToast: () => ({
    add: toastAddMock,
  }),
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
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
      getFile: vi.fn(() => new File(['content'], 'video.mp4', { type: 'video/mp4' })),
    },
  }),
}));

vi.mock('~/composables/useDraggedFile', () => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-internal-file',
  FILE_MANAGER_MOVE_DRAG_TYPE: 'application/fastcat-file-manager-move',
  FILE_MANAGER_COPY_DRAG_TYPE: 'application/fastcat-file-manager-copy',
  FILE_MANAGER_ITEMS_DRAG_TYPE: 'application/fastcat-file-manager-items',
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
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.stubGlobal('useToast', () => ({
  add: toastAddMock,
}));

vi.stubGlobal('useI18n', () => ({
  t: (key: string) => key,
}));

describe('useGlobalDragAndDrop', () => {
  beforeEach(() => {
    draggedFileRef.value = null;
    uiStoreMock.isFileManagerDragging = false;
    uiStoreMock.isGlobalDragging = false;
    handleFilesMock.mockReset();
    onDragDropEventMock.mockReset();
    onDragDropEventMock.mockResolvedValue(vi.fn());
    toastAddMock.mockReset();
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
    await callback({
      payload: { type: 'drop', paths: ['/tmp/image.png'], position: { x: 20, y: 40 } },
    });
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

  it('keeps upload overlay visible across transient OS dragleave events', async () => {
    let api: ReturnType<typeof useGlobalDragAndDrop> | null = null;
    const component = defineComponent({
      setup() {
        api = useGlobalDragAndDrop();
        return () => null;
      },
    });

    const wrapper = mount(component);
    await flushPromises();
    vi.useFakeTimers();

    try {
      api?.onGlobalDragOver({
        preventDefault: vi.fn(),
        dataTransfer: {
          types: ['Files'],
        },
      } as unknown as DragEvent);

      expect(uiStoreMock.isGlobalDragging).toBe(true);

      api?.onGlobalDragLeave({
        relatedTarget: null,
      } as unknown as DragEvent);

      expect(uiStoreMock.isGlobalDragging).toBe(true);
      vi.advanceTimersByTime(119);
      expect(uiStoreMock.isGlobalDragging).toBe(true);

      api?.onGlobalDragOver({
        preventDefault: vi.fn(),
        dataTransfer: {
          types: ['Files'],
        },
      } as unknown as DragEvent);

      vi.advanceTimersByTime(120);
      expect(uiStoreMock.isGlobalDragging).toBe(true);

      api?.onGlobalDragLeave({
        relatedTarget: null,
      } as unknown as DragEvent);
      vi.advanceTimersByTime(120);

      expect(uiStoreMock.isGlobalDragging).toBe(false);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it('passes targetDirPath to handleFiles when Tauri drop lands on a folder element', async () => {
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

    const mockFolderEl = {
      getAttribute: vi.fn().mockReturnValue('_video'),
    } as unknown as Element;

    const mockPointEl = {
      closest: vi.fn().mockReturnValue(mockFolderEl),
    } as unknown as Element;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(mockPointEl);

    try {
      await callback({
        payload: {
          type: 'drop',
          paths: ['/tmp/video.mp4'],
          position: { x: 200, y: 300 },
        },
      });
      await flushPromises();

      expect(handleFilesMock).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ targetDirPath: '_video' }),
      );
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      wrapper.unmount();
    }
  });

  it('auto-sorts Tauri drop when no folder element is under the cursor', async () => {
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

    const mockPointEl = {
      closest: vi.fn().mockReturnValue(null),
    } as unknown as Element;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(mockPointEl);

    try {
      await callback({
        payload: {
          type: 'drop',
          paths: ['/tmp/video.mp4'],
          position: { x: 200, y: 300 },
        },
      });
      await flushPromises();

      expect(handleFilesMock).toHaveBeenCalledWith(expect.any(Array), undefined);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      wrapper.unmount();
    }
  });

  it('cancels drop and shows toast when dropped outside zones in Tauri', async () => {
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

    // Simulate overlay is visible
    uiStoreMock.isGlobalDragging = true;

    // elementFromPoint returns something not matching auto zone or folder
    const mockPointEl = {
      closest: vi.fn().mockReturnValue(null),
    } as unknown as Element;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(mockPointEl);

    try {
      await callback({
        payload: {
          type: 'drop',
          paths: ['/tmp/video.mp4'],
          position: { x: 200, y: 300 },
        },
      });
      await flushPromises();

      // Should cancel: no file handling, toast shown, overlay hidden
      expect(handleFilesMock).not.toHaveBeenCalled();
      expect(toastAddMock).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'neutral',
          title: 'videoEditor.fileManager.dropOverlay.cancelled',
        }),
      );
      expect(uiStoreMock.isGlobalDragging).toBe(false);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      wrapper.unmount();
    }
  });

  it('allows drop and auto-sorts when dropped on auto zone in Tauri', async () => {
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

    // Simulate overlay is visible
    uiStoreMock.isGlobalDragging = true;

    // elementFromPoint returns auto zone element
    const mockAutoZoneEl = {
      closest: vi.fn().mockImplementation((sel) => {
        if (sel === '.global-drop-overlay-auto-zone') return {};
        return null;
      }),
    } as unknown as Element;

    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(mockAutoZoneEl);

    try {
      await callback({
        payload: {
          type: 'drop',
          paths: ['/tmp/video.mp4'],
          position: { x: 200, y: 300 },
        },
      });
      await flushPromises();

      // Should succeed: file handling called, no toast
      expect(handleFilesMock).toHaveBeenCalledWith(expect.any(Array), undefined);
      expect(toastAddMock).not.toHaveBeenCalled();
      expect(uiStoreMock.isGlobalDragging).toBe(false);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
      wrapper.unmount();
    }
  });
});
