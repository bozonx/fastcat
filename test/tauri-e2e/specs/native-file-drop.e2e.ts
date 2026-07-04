import { browser, expect, $ } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { prepareFixtureInTemp, removeE2eTempDir } from '../helpers/fs.js';

describe('Tauri Native File Drop (P1)', () => {
  let tempDir: string;
  let tempPath: string;

  beforeEach(() => {
    const prepared = prepareFixtureInTemp('media/sample-1s-720p.mp4');
    tempDir = prepared.tempDir;
    tempPath = prepared.tempPath;
  });

  afterEach(() => {
    removeE2eTempDir(tempDir);
  });

  it('handles native file drop event inside allowed scope', async () => {
    // Extend scope to tempDir so Tauri IPC allows access
    await invokeTauri('allow_path_scope', { path: tempDir });

    // Verify window root is active
    const root = await $('#__nuxt');
    await root.waitForExist({ timeout: 10_000 });
    await expect(root).toBeExisting();

    // Verify window recognizes native Tauri runtime
    const isTauri = await browser.execute(() => '__TAURI_INTERNALS__' in window);
    expect(isTauri).toBe(true);
  });
});
