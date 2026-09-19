import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFastcatEmbed,
  DEFAULT_EMBED_ALLOW,
  createEmbedNonce,
  buildEmbedUrl,
  parseEmbedHandshakeParams,
  createEnvelope,
  hasEmbedProtocolVersion,
  isEmbedEnvelope,
  validateEmbedMessage,
} from '~embed';

describe('embed SDK iframe creation and attributes', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(window, 'setTimeout').mockReturnValue(123 as unknown as NodeJS.Timeout);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('exports expected default permissions policy in DEFAULT_EMBED_ALLOW', () => {
    expect(DEFAULT_EMBED_ALLOW).toContain('fullscreen');
    expect(DEFAULT_EMBED_ALLOW).toContain('clipboard-read');
    expect(DEFAULT_EMBED_ALLOW).toContain('clipboard-write');
    expect(DEFAULT_EMBED_ALLOW).toContain('autoplay');
    expect(DEFAULT_EMBED_ALLOW).toContain('cross-origin-isolated');
  });

  it('sets default allow permissions and no sandbox attribute by default', () => {
    const embed = createFastcatEmbed({
      container,
      editorUrl: 'https://embed.fastcat.video/v1/embed',
    });

    expect(embed.iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(embed.iframe.allow).toBe(DEFAULT_EMBED_ALLOW);
    expect(embed.iframe.hasAttribute('sandbox')).toBe(false);
    expect(container.contains(embed.iframe)).toBe(true);
  });

  it('allows overriding the allow attribute', () => {
    const customAllow = 'fullscreen; autoplay';
    const embed = createFastcatEmbed({
      container,
      editorUrl: 'https://embed.fastcat.video/v1/embed',
      allow: customAllow,
    });

    expect(embed.iframe.allow).toBe(customAllow);
  });

  it('sets the sandbox attribute when provided', () => {
    const sandboxPolicy =
      'allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox';
    const embed = createFastcatEmbed({
      container,
      editorUrl: 'https://embed.fastcat.video/v1/embed',
      sandbox: sandboxPolicy,
    });

    expect(embed.iframe.getAttribute('sandbox')).toBe(sandboxPolicy);
  });

  it('creates valid nonce and handshake URL parameters', () => {
    const nonce = createEmbedNonce();
    expect(nonce).toHaveLength(32);

    const url = buildEmbedUrl('https://embed.fastcat.video/v1/embed', {
      nonce,
      hostOrigin: 'https://example.com',
    });

    const parsed = new URL(url);
    const hashParams = parseEmbedHandshakeParams(parsed.hash);
    expect(hashParams).toEqual({
      nonce,
      hostOrigin: 'https://example.com',
    });
  });

  it('becomes unavailable when the init payload cannot be sent', () => {
    const onUnavailable = vi.fn();
    const embed = createFastcatEmbed({
      container,
      editorUrl: 'https://embed.fastcat.video/v1/embed',
      assets: [{ url: 'https://example.com/clip.mp4', filename: '../clip.mp4' }],
      onUnavailable,
    });
    const nonce = parseEmbedHandshakeParams(new URL(embed.iframe.src).hash)!.nonce;

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://embed.fastcat.video',
        source: embed.iframe.contentWindow,
        data: createEnvelope(nonce, 'ready', {
          version: 1,
          capabilities: {
            webgpu: true,
            webcodecs: true,
            opfs: true,
            sharedArrayBuffer: true,
            storageQuotaBytes: null,
          },
        }),
      }),
    );

    expect(embed.state).toBe('unavailable');
    expect(onUnavailable).toHaveBeenCalledWith(
      'protocol-invalid-payload: Invalid payload for init',
    );
  });

  it('lets the host cancel an export the user started inside the editor', () => {
    const onError = vi.fn();
    const embed = createFastcatEmbed({
      container,
      editorUrl: 'https://embed.fastcat.video/v1/embed',
      onError,
    });
    const nonce = parseEmbedHandshakeParams(new URL(embed.iframe.src).hash)!.nonce;
    const post = vi.spyOn(embed.iframe.contentWindow!, 'postMessage');
    const receive = (type: string, payload: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://embed.fastcat.video',
          source: embed.iframe.contentWindow,
          data: createEnvelope(nonce, type, payload),
        }),
      );

    receive('ready', {
      version: 1,
      capabilities: {
        webgpu: true,
        webcodecs: true,
        opfs: true,
        sharedArrayBuffer: true,
        storageQuotaBytes: null,
      },
    });
    receive('initialized', {
      assetCount: 1,
      durationMs: 1000,
      layout: 'desktop',
      reclaimedSessions: 0,
    });
    expect(embed.state).toBe('active');

    receive('export:progress', { phase: 'encoding', progress: 0.1 });
    expect(embed.state).toBe('exporting');
    embed.cancelExport();
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'export:cancel' }),
      'https://embed.fastcat.video',
    );

    receive('export:error', { message: 'Export cancelled', reason: 'cancelled' });
    expect(embed.state).toBe('active');
    expect(onError).toHaveBeenLastCalledWith({
      code: 'export-cancelled',
      message: 'Export cancelled',
    });
    receive('export:error', { message: 'Encoder crashed' });
    expect(onError).toHaveBeenLastCalledWith({ code: 'export-failed', message: 'Encoder crashed' });
  });
});

describe('embed protocol runtime validation', () => {
  it('separates a valid envelope from a protocol version mismatch', () => {
    const envelope = createEnvelope('nonce', 'ready', {
      version: 999,
      capabilities: {},
    });
    envelope.version = 999;

    expect(isEmbedEnvelope(envelope, 'nonce')).toBe(true);
    expect(hasEmbedProtocolVersion(envelope)).toBe(false);
  });

  it('rejects malformed payloads and unknown messages with stable codes', () => {
    expect(
      validateEmbedMessage('host', 'asset:add', { assets: [{ url: 'file:///secret' }] }),
    ).toMatchObject({
      ok: false,
      code: 'protocol-invalid-payload',
    });
    expect(validateEmbedMessage('editor', 'not-a-message', {})).toMatchObject({
      ok: false,
      code: 'protocol-unknown-message',
    });
  });

  it('limits project defaults and export filenames', () => {
    expect(
      validateEmbedMessage('host', 'init', { projectDefaults: { width: 100_000 } }),
    ).toMatchObject({
      ok: false,
      code: 'protocol-invalid-payload',
    });
    expect(
      validateEmbedMessage('host', 'export:start', { filename: '../render.mp4' }),
    ).toMatchObject({
      ok: false,
      code: 'protocol-invalid-payload',
    });
  });

  it('accepts an export request without optional settings', () => {
    expect(validateEmbedMessage('host', 'export:start', undefined)).toEqual({ ok: true });
  });

  it('accepts Unicode and punctuation in display filenames', () => {
    for (const filename of [
      'Generated Image March 26, 2026 - 8_53PM.jpg',
      'Видео про кота.mp4',
      'clip(1).mp4',
      'my+video.mp4',
    ]) {
      expect(
        validateEmbedMessage('host', 'init', {
          assets: [{ url: 'https://example.com/a', filename }],
        }),
      ).toEqual({ ok: true });
    }
  });

  it('accepts names that merely contain two dots', () => {
    for (const filename of ['Wait...mp4', 'v1..final.mp4']) {
      expect(validateEmbedMessage('host', 'export:start', { filename })).toEqual({ ok: true });
    }
  });

  it('ignores feature names it does not know instead of refusing the session', () => {
    expect(
      validateEmbedMessage('host', 'init', { features: ['files', 'something-newer'] }),
    ).toEqual({ ok: true });
    expect(validateEmbedMessage('host', 'init', { features: [42] })).toMatchObject({
      ok: false,
      code: 'protocol-invalid-payload',
    });
  });

  it('still rejects traversal and NUL in filenames', () => {
    for (const filename of [
      '..',
      '.',
      '../clip.mp4',
      'dir/clip.mp4',
      'dir\\clip.mp4',
      'clip\0.mp4',
    ]) {
      expect(
        validateEmbedMessage('host', 'init', {
          assets: [{ url: 'https://example.com/a', filename }],
        }),
      ).toMatchObject({
        ok: false,
        code: 'protocol-invalid-payload',
      });
    }
  });
});
