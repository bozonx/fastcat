import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testFilesRoot = path.join(repoRoot, 'test-files');
const scope = process.argv[2]?.trim();

if (scope && (path.isAbsolute(scope) || scope.includes('..'))) {
  throw new Error(`Invalid test-files scope: ${scope}`);
}

const target = scope ? path.join(testFilesRoot, scope) : testFilesRoot;
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

console.log(`[test-files] cleaned ${path.relative(repoRoot, target)}`);
