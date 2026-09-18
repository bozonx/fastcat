# @bozonx/fastcat

The prebuilt **FastCat video editor** for hosting it yourself, plus the
response headers it needs.

[![npm version](https://img.shields.io/npm/v/@bozonx/fastcat.svg)](https://www.npmjs.com/package/@bozonx/fastcat)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Which package do I need?

| You want to                                                         | Package                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Embed the editor from FastCat's own hosting (`embed.fastcat.video`) | [`@bozonx/fastcat-embed`](https://www.npmjs.com/package/@bozonx/fastcat-embed) only |
| Serve the editor from your own domain                               | `@bozonx/fastcat` to deploy, `@bozonx/fastcat-embed` in your page                   |

Both are released together and always share a version number. Keep them equal.

## Contents

- `editor/` — the static production build of the web editor (standalone app
  and the embeddable `/embed` route).
- `@bozonx/fastcat/hosting` — functions that compute the response headers for
  any path of the build.
- [`HOSTING.md`](HOSTING.md) — what a host must serve and why: origin, headers,
  cross-origin isolation, requirements for media sources.

## Quick start

```bash
pnpm add -D @bozonx/fastcat
pnpm add @bozonx/fastcat-embed
```

Deploy `node_modules/@bozonx/fastcat/editor` to the root of a dedicated origin
with headers from `resolveHostingHeaders()`, then:

```ts
import { createFastcatEmbed } from '@bozonx/fastcat-embed';

createFastcatEmbed({
  container: document.getElementById('editor')!,
  editorUrl: 'https://video.example.com/embed',
});
```

See [`HOSTING.md`](HOSTING.md) for the full contract.

## License

MIT
