import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

function parseArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const host = parseArg('--host', '127.0.0.1');
const port = Number(parseArg('--port', '3007'));
const root = resolve(parseArg('--root', '.output/public'));

function setIsolationHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
}

async function resolvePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0] || '/');
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(root, normalizedPath);

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      return join(candidate, 'index.html');
    }
    return candidate;
  } catch {
    if (!extname(candidate)) {
      const htmlCandidate = `${candidate}.html`;
      try {
        await access(htmlCandidate);
        return htmlCandidate;
      } catch {
        return join(root, 'index.html');
      }
    }
    return null;
  }
}

const server = createServer(async (req, res) => {
  setIsolationHeaders(res);

  const filePath = await resolvePath(req.url ?? '/');
  if (!filePath) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    // Advertise byte-range support so the browser can seek within media the way
    // it does against the real prod server (video seek relies on Range/206).
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
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
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(info.size));
    createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Static preview server listening on http://${host}:${port}/`);
});
