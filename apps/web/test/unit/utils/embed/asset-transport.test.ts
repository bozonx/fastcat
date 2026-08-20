/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFileTransport, createUrlTransport } from '~/utils/embed/asset-transport';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function rangeResponse(bytes: Uint8Array, total: number, start = 0, contentType?: string) {
  return {
    ok: true,
    status: 206,
    headers: new Headers({
      'Content-Range': `bytes ${start}-${start + bytes.length - 1}/${total}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    }),
    arrayBuffer: async () => bytes.buffer,
    body: null,
  };
}

beforeEach(() => mockFetch.mockReset());

describe('url transport', () => {
  it('reads the total size out of Content-Range', async () => {
    mockFetch.mockResolvedValueOnce(rangeResponse(new Uint8Array([1]), 4096, 0, 'video/mp4'));

    const transport = createUrlTransport({ id: 'a', url: 'https://example.com/v.mp4' });
    expect(await transport.getSize()).toBe(4096);
    expect(await transport.getContentType()).toBe('video/mp4');
    // Probing twice must not cost a second round trip.
    expect(await transport.getSize()).toBe(4096);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns the MIME type for an extensionless signed URL from the same probe', async () => {
    mockFetch.mockResolvedValueOnce(
      rangeResponse(new Uint8Array([1]), 4096, 0, 'audio/ogg; charset=binary'),
    );

    const transport = createUrlTransport({ id: 'a', url: 'https://example.com/signed' });
    expect(await transport.getContentType()).toBe('audio/ogg');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('asks the host for a fresh URL when the signed one stops authorising', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() })
      .mockResolvedValueOnce(rangeResponse(new Uint8Array([1]), 10));

    const requestFreshUrl = vi.fn().mockResolvedValue('https://example.com/v.mp4?sig=new');
    const transport = createUrlTransport({
      id: 'a',
      url: 'https://example.com/v.mp4?sig=old',
      requestFreshUrl,
    });

    expect(await transport.getSize()).toBe(10);
    expect(requestFreshUrl).toHaveBeenCalledWith('a');
    expect(mockFetch.mock.calls[1]![0]).toContain('sig=new');
  });

  it('shares one refresh between reads that expire together', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('sig=new')
          ? rangeResponse(new Uint8Array([7]), 10)
          : { ok: false, status: 401, headers: new Headers() },
      ),
    );

    const requestFreshUrl = vi.fn(async () => {
      await Promise.resolve();
      return 'https://example.com/v.mp4?sig=new';
    });
    const transport = createUrlTransport({
      id: 'a',
      url: 'https://example.com/v.mp4',
      requestFreshUrl,
    });

    await Promise.all([transport.readRange(0, 1), transport.readRange(1, 2)]);

    // One expiry, one refresh — not one per concurrent reader. A busy timeline
    // has many reads in flight and would otherwise storm the host.
    expect(requestFreshUrl).toHaveBeenCalledOnce();
  });

  it('slices out the window when a server ignores the range header', async () => {
    const whole = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => whole.buffer,
    });

    const transport = createUrlTransport({ id: 'a', url: 'https://example.com/v.mp4' });
    expect(Array.from(await transport.readRange(2, 5))).toEqual([2, 3, 4]);
  });

  it('surfaces a genuine failure rather than returning short data', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, headers: new Headers() });

    const transport = createUrlTransport({ id: 'a', url: 'https://example.com/v.mp4' });
    await expect(transport.readRange(0, 10)).rejects.toThrow(/HTTP 500/);
  });
});

describe('file transport', () => {
  it('serves ranges straight out of the host-supplied file', async () => {
    const file = new File([new Uint8Array([9, 8, 7, 6])], 'clip.mp4');
    const transport = createFileTransport('a', file);

    expect(await transport.getSize()).toBe(4);
    expect(await transport.getContentType()).toBeNull();
    expect(Array.from(await transport.readRange(1, 3))).toEqual([8, 7]);
  });
});
