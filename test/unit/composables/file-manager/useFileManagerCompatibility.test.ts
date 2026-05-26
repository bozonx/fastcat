/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, reactive } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useFileManagerCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useMediaStore } from '~/stores/media.store';
import type { FsEntry } from '~/types/fs';

vi.mock('~/stores/media.store', () => ({
  useMediaStore: vi.fn(),
}));

describe('useFileManagerCompatibility', () => {
  let mediaMetadata: any;
  let metadataLoadFailed: any;
  let metadataLoading: any;
  let getOrFetchMetadataByPathMock: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    mediaMetadata = reactive({});
    metadataLoadFailed = reactive({});
    metadataLoading = reactive({});
    getOrFetchMetadataByPathMock = vi.fn();

    vi.mocked(useMediaStore).mockReturnValue({
      mediaMetadata,
      metadataLoadFailed,
      metadataLoading,
      getOrFetchMetadataByPath: getOrFetchMetadataByPathMock,
    } as any);
  });

  it('determines status for standard project files', () => {
    const entries = ref<FsEntry[]>([
      { kind: 'file', name: 'image.png', path: 'image.png', source: 'local' },
    ]);

    const { compatibility } = useFileManagerCompatibility(entries);

    // Initial state without metadata (project file -> 'checking')
    expect(compatibility.value['image.png']?.status).toBe('checking');

    // Loaded successfully
    mediaMetadata['image.png'] = { image: { canDisplay: true } };
    expect(compatibility.value['image.png']?.status).toBe('ok');

    // Load failed
    metadataLoadFailed['image.png'] = true;
    expect(compatibility.value['image.png']?.status).toBe('corrupt');
  });

  it('handles external files with external: prefix in cache', () => {
    const path = '/abs/external_failed_image.png';
    const entries = ref<FsEntry[]>([
      { kind: 'file', name: 'external_failed_image.png', path, source: 'local' },
    ]);

    const { compatibility } = useFileManagerCompatibility(entries);

    // External file without metadata should default to 'ok' instead of 'checking' to prevent infinite spinner
    expect(compatibility.value[path]?.status).toBe('ok');

    // After properties panel loads it, it is saved under external: prefix
    mediaMetadata[`external:${path}`] = { error: true };
    expect(compatibility.value[path]?.status).toBe('corrupt');
  });

  it('handles remote files with external: prefix in cache', () => {
    const path = '/remote/failed_image.png';
    const entries = ref<FsEntry[]>([
      { kind: 'file', name: 'failed_image.png', path, source: 'remote' },
    ]);

    const { compatibility } = useFileManagerCompatibility(entries);

    // Remote file without metadata should default to 'ok' instead of 'checking'
    expect(compatibility.value[path]?.status).toBe('ok');

    // Mark as failed under external: prefix
    metadataLoadFailed[`external:${path}`] = true;
    expect(compatibility.value[path]?.status).toBe('corrupt');
  });

  it('identifies image as corrupt when image.canDisplay is false', () => {
    const entries = ref<FsEntry[]>([
      { kind: 'file', name: 'failed.png', path: 'failed.png', source: 'local' },
    ]);

    const { compatibility } = useFileManagerCompatibility(entries);

    // Metadata is loaded but has canDisplay: false
    mediaMetadata['failed.png'] = { image: { canDisplay: false } };
    expect(compatibility.value['failed.png']?.status).toBe('corrupt');
  });
});
