/**
 * Serves the embed host stand on an origin of its own.
 *
 * The whole point of this server is that it is NOT the editor's origin: a host
 * page loaded from the same origin as `/embed` would silently pass checks that
 * fail against a real third-party integration. Both the dev workflow
 * (`pnpm dev:embed`) and the `embed` Playwright tier use it.
 *
 * It serves three things:
 *   - the stand itself (`dev/embed-host/`),
 *   - `@bozonx/embed` compiled straight from `packages/embed/src`, so the stand
 *     always exercises the same protocol source the editor compiles against,
 *   - media fixtures with CORS and byte ranges, standing in for a host's signed
 *     asset URLs.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

function parseArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const host = parseArg('--host', '127.0.0.1');
const port = Number(parseArg('--port', '3011'));
const editorUrl = parseArg('--editor', 'http://localhost:3008/embed');
const standRoot = resolve(parseArg('--stand', 'dev/embed-host'));
const mediaRoot = resolve(parseArg('--media', 'test/fixtures/media'));
const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/embed/src');

/** Rewrites extensionless relative imports so the browser can resolve them. */
function addModuleExtensions(code) {
  return code.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, head, spec, tail) =>
    extname(spec) ? match : `${head}${spec}.js${tail}`,
  );
}

async function serveSdk(res, requestPath) {
  const name = requestPath.slice('/sdk/'.length).replace(/\.js$/, '');
  if (!/^[a-z0-9-]+$/i.test(name)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  try {
    const source = await readFile(join(sdkRoot, `${name}.ts`), 'utf8');
    const { code } = await transformWithOxc(source, `${name}.ts`, { lang: 'ts' });
    res.setHeader('Content-Type', MIME_TYPES['.js']);
    res.setHeader('Cache-Control', 'no-store');
    res.end(addModuleExtensions(code));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

/** Serves a file, honouring Range so media behaves as it would behind a CDN. */
async function serveFile(req, res, filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  if (!info.isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.setHeader('Content-Type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] !== '' || match[2] !== '')) {
    const size = info.size;
    let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
    let end = match[2] === '' || match[1] === '' ? size - 1 : Number(match[2]);
    start = Math.max(0, start);
    end = Math.min(size - 1, end);

    if (start > end || Number.isNaN(start) || Number.isNaN(end)) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }

    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Length', String(info.size));
  createReadStream(filePath).pipe(res);
}

function safeJoin(root, requestPath, prefix) {
  const relative = normalize(decodeURIComponent(requestPath.slice(prefix.length))).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  return join(root, relative);
}

/** Paths that have already burned their one-shot `?expire=1` authorisation. */
const expiredOnce = new Set();

/** Byte counts received on `PUT /upload/…`, standing in for a host's storage. */
const uploads = new Map();

const server = createServer(async (req, res) => {
  const requestPath = (req.url ?? '/').split('?')[0];

  // Media stands in for a host's signed asset URLs: cross-origin, range-capable,
  // and exposing the headers a range reader needs to see.
  if (requestPath.startsWith('/media/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // `?expire=1` makes this URL authorise exactly once, so the embed tier can
    // exercise the refresh path the way a real signed URL behaves.
    if ((req.url ?? '').includes('expire=1')) {
      const key = requestPath;
      if (expiredOnce.has(key)) {
        expiredOnce.delete(key);
      } else {
        expiredOnce.add(key);
        res.statusCode = 403;
        res.end('URL expired');
        return;
      }
    }
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.statusCode = 204;
      res.end();
      return;
    }
    await serveFile(req, res, safeJoin(mediaRoot, requestPath, '/media/'));
    return;
  }

  // Stands in for a host's presigned PUT endpoint, so `output: 'upload'` is
  // exercised end to end rather than only declared in the protocol.
  if (requestPath.startsWith('/upload/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      let received = 0;
      req.on('data', (chunk) => (received += chunk.length));
      req.on('end', () => {
        uploads.set(requestPath, received);
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({ receivedBytes: uploads.get(requestPath) ?? 0 }));
    return;
  }

  if (requestPath.startsWith('/sdk/')) {
    await serveSdk(res, requestPath);
    return;
  }

  if (requestPath === '/config.json') {
    res.setHeader('Content-Type', MIME_TYPES['.json']);
    res.end(JSON.stringify({ editorUrl }));
    return;
  }

  const target = requestPath === '/' ? '/index.html' : requestPath;
  await serveFile(req, res, safeJoin(standRoot, target, '/'));
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Embed host stand listening on http://${host}:${port}/ (editor: ${editorUrl})`);
});
