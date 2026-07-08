import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import TextEditor from '~/components/preview/TextEditor.vue';

const readFileMock = vi.fn();
const writeFileMock = vi.fn();

const mockVfs = {
  readFile: readFileMock,
  writeFile: writeFileMock,
};

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({ vfs: mockVfs }),
}));

vi.mock('~/utils/dev-logger', () => ({
  createDevLogger: () => ({ error: vi.fn() }),
}));

const setPanelFocusMock = vi.fn();
vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({ setPanelFocus: setPanelFocusMock }),
}));

const TextEditorModalStub = {
  props: ['open', 'content', 'filePath', 'fileName', 'isSaving', 'saveError', 'lastSavedAt'],
  emits: ['update:open', 'update:content'],
  template: '<div v-if="open" class="modal-stub" />',
};

const UiTextareaStub = {
  props: ['modelValue', 'variant', 'ui', 'spellcheck', 'fullWidth'],
  emits: ['update:modelValue', 'focus'],
  expose: ['focus'],
  setup(_: unknown, { expose }: { expose: (v: unknown) => void }) {
    const focus = vi.fn();
    expose({ focus });
    return { focus };
  },
  template:
    '<textarea class="textarea-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @focus="$emit(\'focus\')" />',
};

describe('TextEditor', () => {
  const stubs = {
    TextEditorModal: TextEditorModalStub,
    UiTextarea: UiTextareaStub,
    UButton: {
      props: ['icon', 'variant', 'size', 'color'],
      template: '<button class="u-button"><slot /></button>',
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    readFileMock.mockResolvedValue(new Blob(['hello']));
    writeFileMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads file content on mount', async () => {
    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    // flush async read
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    expect(readFileMock).toHaveBeenCalledWith('/file.txt');
    expect(component.find('.textarea-stub').exists()).toBe(true);
    expect(component.find('.textarea-stub').element.value).toBe('hello');
  });

  it('debounces save and writes file after 800ms', async () => {
    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    await component.find('.textarea-stub').setValue('updated content');
    writeFileMock.mockClear();

    // Not saved yet at 700ms
    await vi.advanceTimersByTimeAsync(700);
    expect(writeFileMock).not.toHaveBeenCalled();

    // Saved at 800ms total
    await vi.advanceTimersByTimeAsync(100);
    expect(writeFileMock).toHaveBeenCalledWith('/file.txt', 'updated content');
  });

  it('does not save when content unchanged', async () => {
    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    // Trigger a save cycle without changing content
    writeFileMock.mockClear();
    await vi.advanceTimersByTimeAsync(800);

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('shows read error when readFile fails', async () => {
    readFileMock.mockRejectedValue(new Error('read fail'));

    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    expect(component.text()).toContain('Failed to read file');
  });

  it('shows write error when writeFile fails', async () => {
    writeFileMock.mockRejectedValue(new Error('write fail'));

    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    await component.find('.textarea-stub').setValue('changed');
    await vi.advanceTimersByTimeAsync(800);
    await nextTick();

    expect(component.text()).toContain('Failed to save file');
  });

  it('shows loading state when filePath empty then finishes', async () => {
    const component = await mountSuspended(TextEditor, {
      props: { filePath: '' },
      global: { stubs },
    });

    // Empty path: loadContent sets isLoading=false immediately, but watcher flush is post.
    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    expect(readFileMock).not.toHaveBeenCalled();
    expect(component.find('.textarea-stub').exists()).toBe(true);
  });

  it('opens modal when expand button clicked', async () => {
    const component = await mountSuspended(TextEditor, {
      props: { filePath: '/file.txt' },
      global: { stubs },
    });

    await vi.advanceTimersByTimeAsync(0);
    await nextTick();

    await component.find('.u-button').trigger('click');
    await nextTick();

    expect(component.find('.modal-stub').exists()).toBe(true);
  });
});
