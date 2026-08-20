import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFastcatEmbed,
  DEFAULT_EMBED_ALLOW,
  createEmbedNonce,
  buildEmbedUrl,
  parseEmbedHandshakeParams,
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
});
