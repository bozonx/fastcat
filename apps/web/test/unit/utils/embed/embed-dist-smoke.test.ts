import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../../../../../..');
const EMBED_PKG_DIR = resolve(ROOT, 'packages/embed');
const DIST_DIR = resolve(EMBED_PKG_DIR, 'dist');
const PKG_JSON_PATH = resolve(EMBED_PKG_DIR, 'package.json');

describe('@fastcat/embed package build and distribution smoke test', () => {
  beforeAll(() => {
    // Ensure dist is built before running assertions
    execSync('pnpm --filter @fastcat/embed build', { stdio: 'pipe', cwd: ROOT });
  });

  it('generates all expected dist files (.js, .d.ts, sourcemaps)', () => {
    const requiredFiles = [
      'index.js',
      'index.js.map',
      'index.d.ts',
      'index.d.ts.map',
      'protocol.js',
      'protocol.js.map',
      'protocol.d.ts',
      'protocol.d.ts.map',
    ];

    for (const file of requiredFiles) {
      const fullPath = resolve(DIST_DIR, file);
      expect(existsSync(fullPath), `Expected ${file} to exist in dist/`).toBe(true);
    }
  });

  it('validates package.json exports, types, files and engines fields', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON_PATH, 'utf8'));

    expect(pkg.name).toBe('@fastcat/embed');
    expect(pkg.type).toBe('module');
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.module).toBe('./dist/index.js');
    expect(pkg.types).toBe('./dist/index.d.ts');

    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
    expect(pkg.exports['./protocol']).toEqual({
      types: './dist/protocol.d.ts',
      import: './dist/protocol.js',
      default: './dist/protocol.js',
    });
    expect(pkg.exports['./package.json']).toBe('./package.json');

    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('LICENSE');

    expect(pkg.engines?.node).toBeDefined();
    expect(pkg.sideEffects).toBe(false);
  });

  it('dynamically imports compiled ESM entry points and verifies exports', async () => {
    const mainEntry = await import(`file://${resolve(DIST_DIR, 'index.js')}`);
    const protocolEntry = await import(`file://${resolve(DIST_DIR, 'protocol.js')}`);

    expect(typeof mainEntry.createFastcatEmbed).toBe('function');
    expect(typeof mainEntry.DEFAULT_EMBED_ALLOW).toBe('string');
    expect(typeof mainEntry.createEmbedNonce).toBe('function');
    expect(typeof mainEntry.buildEmbedUrl).toBe('function');
    expect(typeof mainEntry.parseEmbedHandshakeParams).toBe('function');
    expect(typeof mainEntry.isEmbedEnvelope).toBe('function');
    expect(typeof mainEntry.createEnvelope).toBe('function');
    expect(mainEntry.EMBED_CHANNEL).toBe('fastcat-embed');
    expect(mainEntry.EMBED_PROTOCOL_VERSION).toBe(1);

    expect(typeof protocolEntry.createEmbedNonce).toBe('function');
    expect(typeof protocolEntry.buildEmbedUrl).toBe('function');
    expect(typeof protocolEntry.parseEmbedHandshakeParams).toBe('function');
    expect(typeof protocolEntry.isEmbedEnvelope).toBe('function');
    expect(typeof protocolEntry.createEnvelope).toBe('function');
    expect(protocolEntry.EMBED_CHANNEL).toBe('fastcat-embed');
    expect(protocolEntry.EMBED_PROTOCOL_VERSION).toBe(1);
  });

  it('runs handshake utilities correctly from compiled dist', async () => {
    const { createEmbedNonce, buildEmbedUrl, parseEmbedHandshakeParams } = await import(
      `file://${resolve(DIST_DIR, 'index.js')}`
    );

    const nonce = createEmbedNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);

    const url = buildEmbedUrl('https://embed.fastcat.video/embed', {
      nonce,
      hostOrigin: 'https://host.example.com',
    });

    const parsed = new URL(url);
    const params = parseEmbedHandshakeParams(parsed.hash);
    expect(params).toEqual({
      nonce,
      hostOrigin: 'https://host.example.com',
    });
  });
});
