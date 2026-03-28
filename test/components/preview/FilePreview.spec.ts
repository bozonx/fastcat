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

    // Simulate open-modal event from ImageViewer
    const imageViewer = component.findComponent({ name: 'ImageViewer' });
    await imageViewer.vm.$emit('open-modal');
    await component.vm.$nextTick();

    // Check if modal state is true
    expect((component.vm as any).isMediaModalOpen).toBe(true);
    
    // Check if uiStore count is updated (this is a side effect in the watcher)
    const uiStore = useUiStore();
    expect(uiStore.activeModalsCount).toBe(1);

    // Close modal
    const closeBtn = component.findComponent({ name: 'UButton' }); 
    // The button is inside the teleport, so we might need to find it differently if teleported to body.
    // However, Vue Test Utils can often find components even if teleported if they are within the same tree.
    // If not, we can trigger the close logic directly.
    await (component.vm as any).closeMediaModal();
    await component.vm.$nextTick();
    expect((component.vm as any).isMediaModalOpen).toBe(false);
    expect(uiStore.activeModalsCount).toBe(0);
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

    // Open modal
    await mediaPlayer.vm.$emit('open-modal');
    await component.vm.$nextTick();

    expect((component.vm as any).mediaPlaybackState).toEqual(expect.objectContaining({
      currentTime: 10,
      isPlaying: true,
      source: 'inline'
    }));

    // In modal, MediaPlayer should receive this state through resumeState prop
    // We can't easily check props of a component inside a v-if inside a Teleport 
    // without more complex setup, but we verified the state update.
  });

  it('closes modal on Esc key', async () => {
    const component = await mountWithNuxt(FilePreview, {
      props: {
        url: 'http://example.com/test.jpg',
        mediaType: 'image',
      },
    });

    // Open modal
    await (component.vm as any).openMediaModal();
    await component.vm.$nextTick();
    expect((component.vm as any).isMediaModalOpen).toBe(true);

    // Mock window event listener trigger
    // FilePreview adds listener to window on mounted.
    // We can manually call the handler if we can access it, 
    // or dispatch a keyboard event on window.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);
    
    await component.vm.$nextTick();
    // Note: isCommandMatched might need careful mocking if it fails in test.
    // In our case, DEFAULT_HOTKEYS should have general.deselect as Escape.
    expect((component.vm as any).isMediaModalOpen).toBe(false);
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

    expect((component.vm as any).isMediaModalOpen).toBe(true);
  });
});
