// Builds the web editor for publishing and copies it into `editor/`.
//
// The published build is the production one with the test-only pages
// (`/test/*`, used by the e2e and golden tiers) left out. Dev and e2e switches
// are stripped from the environment so a local shell cannot leak them into a
// release.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageDir, '../..');
const buildOutput = resolve(repoRoot, 'apps/web/.output/public');
const target = resolve(packageDir, 'editor');

const env = { ...process.env, FASTCAT_EXCLUDE_TEST_PAGES: 'true' };
delete env.FASTCAT_ENABLE_IN_DEVELOPMENT_FEATURES;
delete env.E2E_TEST;
delete env.E2E_OUTPUT_DIR;

const result = spawnSync('pnpm', ['--filter', '@fastcat/web', 'generate'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(resolve(buildOutput, 'index.html'))) {
  console.error(`Editor build not found at ${buildOutput}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(buildOutput, target, { recursive: true });
// FastCat's own Pages rules, not a contract for hosts: they take their headers
// from `@bozonx/fastcat/hosting` (see HOSTING.md).
rmSync(resolve(target, '_headers'), { force: true });

console.log(`Editor copied to ${target}`);
