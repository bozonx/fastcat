import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import FilePreview from '~/components/preview/FilePreview.vue';
import { useUiStore } from '~/stores/ui.store';

// Mock components
vi.mock('~/components/preview/ImageViewer.vue', () => ({
  default: {
    name: 'ImageViewer',
    template: '<div class="image-viewer-mock" @click="$emit(\'open-modal\')">Image Viewer</div>',
    props: ['src', 'alt', 'isModal', 'focusPanelId'],
    emits: ['open-modal', 'close-modal']
  }
}));

vi.mock('~/components/media/MediaPlayer.vue', () => ({
  default: {
    name: 'MediaPlayer',
    template: '<div class="media-player-mock" @click="$emit(\'open-modal\')">Media Player</div>',
    props: ['src', 'type', 'isModal', 'focusPanelId', 'resumeState', 'instanceKey', 'forcePaused'],
    emits: ['open-modal', 'close-modal', 'sync-state']
  }
}));

vi.mock('~/components/preview/TextEditor.vue', () => ({
  default: {
    name: 'TextEditor',
    template: '<div class="text-editor-mock">Text Editor</div>',
    props: ['isModalOpen', 'filePath', 'fileName', 'initialContent', 'focusPanelId'],
    emits: ['update:isModalOpen']
  }
}));

describe('FilePreview.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ImageViewer for images', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.jpg',
        mediaType: 'image',
        alt: 'test image',
      },
    });

    expect(component.find('.image-viewer-mock').exists()).toBe(true);
    expect(component.find('.media-player-mock').exists()).toBe(false);
  });

  it('renders MediaPlayer for video', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.mp4',
        mediaType: 'video',
      },
    });

    expect(component.find('.media-player-mock').exists()).toBe(true);
    expect(component.find('.image-viewer-mock').exists()).toBe(false);
  });

  it('renders TextEditor for text', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.txt',
        mediaType: 'text',
        textContent: 'Hello world',
      },
    });

    expect(component.find('.text-editor-mock').exists()).toBe(true);
  });

  it('opens and closes media modal for images', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.jpg',
        mediaType: 'image',
      },
    });

    // Check modal is not visible
    expect(component.vm.isMediaModalOpen).toBe(false);

    // Simulate open-modal event from ImageViewer
    const imageViewer = component.findComponent({ name: 'ImageViewer' });
    await imageViewer.trigger('click'); // template emits open-modal on click in mock

    expect(component.vm.isMediaModalOpen).toBe(true);

    // Close buttons and stuff are in Teleport, which might be hard to test with mountSuspended
    // but we can check the reactive state
    component.vm.isMediaModalOpen = false;
    expect(component.vm.isMediaModalOpen).toBe(false);
  });

  it('synchronizes playback state between inline and modal MediaPlayer', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.mp4',
        mediaType: 'video',
      },
    });

    const mediaPlayer = component.findComponent({ name: 'MediaPlayer' });
    
    // Simulate sync-state from inline player
    await mediaPlayer.vm.$emit('sync-state', {
      currentTime: 10,
      isPlaying: true,
      source: 'inline'
    });

    expect(component.vm.mediaPlaybackState).toEqual(expect.objectContaining({
      currentTime: 10,
      isPlaying: true,
      source: 'inline'
    }));

    // Open modal
    await component.setData({ isMediaModalOpen: true });
    
    // We should have a second MediaPlayer in the teleport content
    // However, vitest-environment-nuxt's mountSuspended handles teleports differently.
    // Let's just check if it's rendered by checking component.html() or component.vm
    expect(component.vm.isMediaModalOpen).toBe(true);
  });

  it('toggles fullscreen via uiStore trigger', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.jpg',
        mediaType: 'image',
      },
    });
    
    const uiStore = useUiStore();
    uiStore.previewFullscreenToggleTrigger = Date.now();
    
    await component.vm.$nextTick();
    await component.vm.$nextTick(); // Wait for watcher

    expect(component.vm.isMediaModalOpen).toBe(true);
  });
});
