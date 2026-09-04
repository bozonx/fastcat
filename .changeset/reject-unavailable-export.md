---
'@fastcat/web': patch
---

Answer an export request the session cannot serve with `export:error` instead of dropping it. A silently ignored `export:start` left the host SDK stuck in `exporting` for good: no progress, no result, and every later export refused as `protocol-invalid-state`.

Send `frame-ancestors` and `Permissions-Policy` from the deployment: `frame-ancestors 'none'` for the standalone editor, and `*` on `/embed` — which is the route meant to be embedded, and whose security boundary is the handshake's origin and nonce checks rather than a guest list.
