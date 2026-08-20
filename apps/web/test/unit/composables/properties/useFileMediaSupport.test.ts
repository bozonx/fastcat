import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFileMediaSupport } from '~/composables/properties/useFileMediaSupport';

function build(overrides: Record<string, any> = {}) {
  const deps = {
    selectedFsEntry: () => ({ kind: 'file', name: 'clip.mp4', path: '/clip.mp4' }) as any,
    mediaType: ref<string | null>('video'),
    mediaMeta: ref<Record<string, unknown> | null>({}),
    fileInfo: ref<{ kind?: string } | null>({ kind: 'file' }),
    isOtio: ref(false),
    isRemoteRoot: ref(false),
    metadataCacheKey: ref<string | null>('/clip.mp4'),
    mediaStore: { metadataLoadFailed: {} as Record<string, boolean> },
    ...overrides,
  };
  return { deps, support: useFileMediaSupport(deps) };
}

describe('useFileMediaSupport', () => {
  it('classifies media type flags', () => {
    expect(build().support.isVideoFile.value).toBe(true);
    expect(build({ mediaType: ref('audio') }).support.isAudioFile.value).toBe(true);
  });

  it('reports audio presence from media meta', () => {
    expect(build({ mediaMeta: ref({ audio: {} }) }).support.isVideoWithAudio.value).toBe(true);
    expect(build({ mediaMeta: ref({}) }).support.isVideoWithAudio.value).toBe(false);
  });

  it('flags unsupported format from metadataLoadFailed', () => {
    const { support } = build({
      metadataCacheKey: ref('/clip.mp4'),
      mediaStore: { metadataLoadFailed: { '/clip.mp4': true } },
    });
    expect(support.isFormatUnsupported.value).toBe(true);
    expect(support.isMediaFullyUnsupported.value).toBe(true);
  });

  it('flags unsupported video/audio codecs', () => {
    const { support } = build({
      mediaMeta: ref({ video: { canDecode: false }, audio: { canDecode: false } }),
    });
    expect(support.isVideoCodecUnsupported.value).toBe(true);
    expect(support.isAudioCodecUnsupported.value).toBe(true);
  });

  it('flags unsupported native image only when canDisplay is false', () => {
    const supported = build({
      selectedFsEntry: () => ({ kind: 'file', name: 'pic.png', path: '/pic.png' }),
      mediaType: ref('image'),
      mediaMeta: ref({ image: { canDisplay: false } }),
    });
    expect(supported.support.isImageUnsupported.value).toBe(true);

    const ok = build({
      selectedFsEntry: () => ({ kind: 'file', name: 'pic.png', path: '/pic.png' }),
      mediaType: ref('image'),
      mediaMeta: ref({ image: { canDisplay: true } }),
    });
    expect(ok.support.isImageUnsupported.value).toBe(false);
  });

  it('derives codec labels preferring parsedCodec', () => {
    const { support } = build({
      mediaMeta: ref({ video: { parsedCodec: 'h264', codec: 'avc1' }, audio: { codec: 'aac' } }),
    });
    expect(support.videoCodecLabel.value).toBe('h264');
    expect(support.audioCodecLabel.value).toBe('aac');
  });

  it('allows conversion only for supported media types', () => {
    expect(build({ mediaType: ref('video') }).support.canConvertFile.value).toBe(true);
    expect(build({ mediaType: ref('text') }).support.canConvertFile.value).toBe(false);
    const unsupported = build({
      mediaType: ref('video'),
      metadataCacheKey: ref('/clip.mp4'),
      mediaStore: { metadataLoadFailed: { '/clip.mp4': true } },
    });
    expect(unsupported.support.canConvertFile.value).toBe(false);
  });

  describe('showPreviewSection', () => {
    it('shows preview for media and non-otio text', () => {
      expect(build({ mediaType: ref('image') }).support.showPreviewSection.value).toBe(true);
      expect(
        build({ mediaType: ref('text'), isOtio: ref(false) }).support.showPreviewSection.value,
      ).toBe(true);
    });

    it('hides preview for directories, remote root, and otio text', () => {
      expect(build({ fileInfo: ref({ kind: 'directory' }) }).support.showPreviewSection.value).toBe(
        false,
      );
      expect(build({ isRemoteRoot: ref(true) }).support.showPreviewSection.value).toBe(false);
      expect(
        build({ mediaType: ref('text'), isOtio: ref(true) }).support.showPreviewSection.value,
      ).toBe(false);
    });
  });
});
