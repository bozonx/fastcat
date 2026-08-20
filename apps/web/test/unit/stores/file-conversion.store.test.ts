/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFileConversionStore } from '~/stores/file-conversion.store';

describe('FileConversionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('has default state', () => {
    const store = useFileConversionStore();
    expect(store.isModalOpen).toBe(false);
    expect(store.isConverting).toBe(false);
    expect(store.conversionError).toBe('');
    expect(store.targetEntry).toBeNull();
    expect(store.mediaType).toBeNull();
  });

  it('computes mediaType from target entry', () => {
    const store = useFileConversionStore();
    store.targetEntry = { kind: 'file', name: 'video.mp4', path: '/video.mp4', source: 'local' };
    expect(store.mediaType).toBe('video');
  });

  it('computes mediaType as image for image files', () => {
    const store = useFileConversionStore();
    store.targetEntry = { kind: 'file', name: 'photo.jpg', path: '/photo.jpg', source: 'local' };
    expect(store.mediaType).toBe('image');
  });

  it('computes mediaType as audio for audio files', () => {
    const store = useFileConversionStore();
    store.targetEntry = { kind: 'file', name: 'track.mp3', path: '/track.mp3', source: 'local' };
    expect(store.mediaType).toBe('audio');
  });
});
