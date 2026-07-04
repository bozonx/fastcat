import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(here, '..', '..', 'fixtures');

/**
 * Creates a unique temporary directory under /tmp/fastcat-tauri-e2e-*.
 */
export function createE2eTempDir(prefix: string): string {
  const tmpRoot = os.tmpdir();
  const dirName = `fastcat-tauri-e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fullPath = path.join(tmpRoot, dirName);
  fs.mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

/**
 * Safely removes a temporary directory and its contents.
 */
export function removeE2eTempDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Copies a fixture file to a new unique temporary directory and returns the absolute paths.
 */
export function prepareFixtureInTemp(
  relativeFixturePath: string,
  targetFileName?: string,
): { tempDir: string; tempPath: string } {
  const sourcePath = path.join(FIXTURES_DIR, relativeFixturePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Fixture file not found: ${sourcePath}`);
  }

  const fileName = targetFileName ?? path.basename(sourcePath);
  const tempDir = createE2eTempDir('fixture');
  const tempPath = path.join(tempDir, fileName);

  fs.copyFileSync(sourcePath, tempPath);
  return { tempDir, tempPath };
}
