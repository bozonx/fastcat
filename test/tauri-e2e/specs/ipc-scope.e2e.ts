import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect } from '@wdio/globals';
import { invokeTauri } from '../helpers/ipc.js';
import { createE2eTempDir, removeE2eTempDir } from '../helpers/fs.js';

describe('Tauri IPC Scope (P0)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createE2eTempDir('scope-test');
  });

  afterEach(() => {
    removeE2eTempDir(tempDir);
  });

  it('allows temporary directory in /tmp/fastcat-tauri-e2e-*', async () => {
    // allow_path_scope expects an existing absolute directory path
    const result = await invokeTauri('allow_path_scope', { path: tempDir });
    expect(result).toBeUndefined();
  });

  it('allows specific dropped file via allow_dropped_file_scope', async () => {
    const filePath = path.join(tempDir, 'dropped-sample.mp4');
    fs.writeFileSync(filePath, 'dummy content');

    const result = await invokeTauri('allow_dropped_file_scope', { path: filePath });
    expect(result).toBeUndefined();
  });

  it('rejects dangerous scope paths: filesystem root and home directory', async () => {
    const rootPath = os.platform() === 'win32' ? 'C:\\' : '/';
    const homePath = os.homedir();

    let rootError: Error | null = null;
    try {
      await invokeTauri('allow_path_scope', { path: rootPath });
    } catch (e) {
      rootError = e as Error;
    }
    expect(rootError).not.toBeNull();
    expect(String(rootError)).toMatch(/filesystem root/i);

    let homeError: Error | null = null;
    try {
      await invokeTauri('allow_path_scope', { path: homePath });
    } catch (e) {
      homeError = e as Error;
    }
    expect(homeError).not.toBeNull();
    expect(String(homeError)).toMatch(/home directory/i);
  });

  it('rejects paths containing sensitive directory components (.git, .env, .ssh, node_modules)', async () => {
    const sensitiveNames = ['.git', '.env', '.ssh', 'node_modules'];

    for (const name of sensitiveNames) {
      const sensitiveDir = path.join(tempDir, name);
      fs.mkdirSync(sensitiveDir, { recursive: true });

      let sensitiveError: Error | null = null;
      try {
        await invokeTauri('allow_path_scope', { path: sensitiveDir });
      } catch (e) {
        sensitiveError = e as Error;
      }
      expect(sensitiveError).not.toBeNull();
      expect(String(sensitiveError)).toMatch(/sensitive component/i);
    }
  });

  it('rejects relative path', async () => {
    let relativeError: Error | null = null;
    try {
      await invokeTauri('allow_path_scope', { path: 'relative/path/test' });
    } catch (e) {
      relativeError = e as Error;
    }
    expect(relativeError).not.toBeNull();
  });
});
