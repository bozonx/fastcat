# Hosting the FastCat editor

`@bozonx/fastcat` ships the production web build of the editor in `editor/`.
This document is the contract a host must meet to serve it. It applies to any
static host; the examples use a Cloudflare Worker.

## What to serve

- Serve `editor/` from the **root of its own origin**, for example
  `https://video.example.com/`. The build assumes `/` as its base path; a
  subpath is not supported.
- The build is a single-page app: unknown paths fall back to `index.html`
  (`200.html` is the same document).
- The embeddable editor is `/embed`. Point `@bozonx/fastcat-embed` at
  `https://video.example.com/embed`.
- Use the same version of `@bozonx/fastcat` and `@bozonx/fastcat-embed`. They
  are released together and always share a version number.

## Why a dedicated origin

Give the editor an origin of its own, never a path on your application's
origin. On a shared origin the editor's code would run with your users'
credentials and share their storage (localStorage keys, cookies, the storage
quota the editor fills with media).

A subdomain of your site (same site, different origin) is the best fit: the
editor's storage is first-party, not partitioned, and the browser still keeps
it apart from your application. Do not add that origin to your API's CORS
allow-list: the editor has no business calling your API with the user's
cookies, and ambient cookies to a same-site API are only held back by CORS and
your CSRF checks.

## Response headers

Compute them with `@bozonx/fastcat/hosting` instead of copying values:

```ts
import { resolveHostingHeaders } from '@bozonx/fastcat/hosting';

const headers = resolveHostingHeaders(url.pathname, {
  embedOnly: true,
  embedIsolation: 'credentialless',
  frameAncestors: ['https://app.example.com'],
});
```

| Option           | Default  | Meaning                                                                                                                     |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `embedOnly`      | `false`  | Every path gets the embed headers and the standalone editor is not offered. Use it when the origin exists only to be framed |
| `embedIsolation` | `'none'` | `'credentialless'` lets an isolated host page extend isolation into the editor (see below)                                  |
| `frameAncestors` | any      | Origins allowed to frame the editor. Narrow it when only your own site embeds it                                            |

What the embed headers contain and why:

| Header                         | Value                                 | Reason                                                                               |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `Cross-Origin-Opener-Policy`   | `unsafe-none`                         | The editor is a frame, not a top-level app                                           |
| `Cross-Origin-Embedder-Policy` | `unsafe-none` or `credentialless`     | See isolation below                                                                  |
| `Cross-Origin-Resource-Policy` | `cross-origin`                        | An isolated host may only frame documents that consent to it                         |
| `Content-Security-Policy`      | `frame-ancestors …`                   | Who may frame the editor                                                             |
| `Permissions-Policy`           | fullscreen, clipboard, autoplay       | Permissions the SDK delegates through `allow` only work if the frame grants them too |
| `Cache-Control`                | `immutable` on `/_nuxt/*`, `/fonts/*` | Content-hashed assets                                                                |

Without `embedOnly`, every other path gets the standalone editor's headers:
`COOP: same-origin`, `COEP: require-corp`, `frame-ancestors 'none'`.

### Cloudflare Worker example

```ts
import { resolveHostingHeaders } from '@bozonx/fastcat/hosting';

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(new URL('/embed', url), 302);

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(
      resolveHostingHeaders(url.pathname, {
        embedOnly: true,
        embedIsolation: 'credentialless',
        frameAncestors: ['https://app.example.com'],
      }),
    )) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
```

With `[assets] directory` pointing at the copied `editor/`,
`not_found_handling = "single-page-application"` and `run_worker_first = true`
so the Worker sees every request.

## Cross-origin isolation and `SharedArrayBuffer`

The editor works without isolation. When it is isolated, it switches on its
own to a shared I/O budget across its workers (`ready.capabilities.sharedArrayBuffer`
reports it). Isolation needs the whole frame tree to agree:

1. The **host page** that contains the iframe sends
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`). Usually
   only a dedicated editor page, not the whole application, because COEP
   affects every third-party resource the page loads.
2. The **editor** is served with `embedIsolation: 'credentialless'`.
3. The iframe carries `allow="cross-origin-isolated"`; the SDK's default
   `allow` already does.

Safari does not support `credentialless` at the time of writing; the editor
then runs without isolation, as it does in any non-isolated host.

## Media sources

With the `url` asset transport the editor reads each asset itself, with range
requests and without credentials. Every media origin must:

- answer CORS for the editor's origin: `GET`, `HEAD`, allowed request header
  `Range`, exposed headers `Content-Length`, `Content-Range`,
  `Accept-Ranges`, `ETag`;
- support `Range` (without it the file is read in one response, which works
  but is slower to start and cannot pick up where it stopped);
- answer an expired or revoked URL with **401, 403 or 410**. The editor then
  sends `asset:url-expired`, and the host answers with a fresh URL. Any other
  status is treated as a failure, not an expiry.

Signed URLs with a short lifetime are the intended way to hand private media
to the editor: it only needs them while it copies the file into its own
storage.

## Content Security Policy of the host page

The host page needs `frame-src` for the editor's origin. The host's policy
does not reach inside the frame, so it does not need to allow the editor's
workers, WebAssembly or media origins.
