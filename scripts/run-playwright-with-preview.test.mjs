import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { E2E_BUILD_COMMAND, cleanPlaywrightFiles } from './run-playwright-with-preview.mjs';

test('preserves the E2E bundle while clearing Playwright artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'fastcat-e2e-runner-'));
  const outputDir = join(root, 'output');
  const reportDir = join(root, 'report');
  const tmpDir = join(root, 'tmp');

  try {
    mkdirSync(join(outputDir, 'public'), { recursive: true });
    mkdirSync(reportDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(outputDir, 'public', 'index.html'), '<!doctype html>');
    writeFileSync(join(reportDir, 'report.html'), 'report');
    writeFileSync(join(tmpDir, 'stale.tmp'), 'stale');

    cleanPlaywrightFiles({
      outputDir: reportDir,
      reportDir: tmpDir,
      tmpDir: join(root, 'fresh-tmp'),
    });

    assert.equal(existsSync(join(outputDir, 'public', 'index.html')), true);
    assert.equal(existsSync(reportDir), false);
    assert.equal(existsSync(tmpDir), false);
    assert.equal(existsSync(join(root, 'fresh-tmp')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('builds only the web workspace for E2E', () => {
  assert.deepEqual(E2E_BUILD_COMMAND, ['--filter', '@fastcat/web', 'build']);
});
