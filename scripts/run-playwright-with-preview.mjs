import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const e2eHost = process.env.E2E_HOST ?? '127.0.0.1';
const playwrightArgs = process.argv.slice(2);

// Inputs whose contents decide whether the prebuilt bundle is still valid.
// Kept coarse on purpose: a superset is safe (rebuilds when it didn't strictly
// need to); a subset would serve a stale bundle.
const BUILD_INPUT_DIRS = ['src', 'shared', 'public'];
const BUILD_INPUT_FILES = ['package.json', 'pnpm-lock.yaml', 'nuxt.config.ts', 'tsconfig.json'];
const BUILD_MANIFEST = '.output/.e2e-build-hash';

async function findAvailablePort(startPort) {
  let port = startPort;

  while (port < startPort + 100) {
    const isFree = await new Promise((resolve) => {
      const server = createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.listen(port, e2eHost, () => {
        server.close(() => resolve(true));
      });
    });

    if (isFree) {
      return port;
    }

    port += 1;
  }

  throw new Error(`Unable to find a free port starting from ${startPort}`);
}

function hashBuildInputs() {
  const hash = createHash('sha256');
  const root = process.cwd();

  const walk = (path) => {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    if (stats.isDirectory()) {
      // node_modules and build output must never feed the input hash.
      const base = path.split('/').pop();
      if (base === 'node_modules' || base === '.output' || base === '.nuxt') return;
      for (const entry of readdirSync(path).sort()) {
        walk(join(path, entry));
      }
    } else if (stats.isFile()) {
      hash.update(path);
      hash.update(String(stats.size));
      hash.update(String(Math.floor(stats.mtimeMs)));
    }
  };

  for (const dir of BUILD_INPUT_DIRS) walk(join(root, dir));
  for (const file of BUILD_INPUT_FILES) {
    const full = join(root, file);
    if (existsSync(full)) hash.update(readFileSync(full));
  }
  return hash.digest('hex');
}

function bundleIndexMtime() {
  try {
    return String(Math.floor(statSync(join(process.cwd(), '.output/public/index.html')).mtimeMs));
  } catch {
    return '';
  }
}

function runBuild(e2ePort) {
  const wantHash = hashBuildInputs();
  const indexMtime = bundleIndexMtime();
  // The manifest pins both the input hash AND the mtime of the bundle we
  // produced, so an external `pnpm build` (non-E2E, no test hooks) that clobbers
  // .output/public invalidates the cache even when inputs are unchanged.
  const wantManifest = `${wantHash}:${indexMtime}`;
  const forceBuild = process.env.E2E_FORCE_BUILD === '1';

  if (!forceBuild && indexMtime) {
    let prevManifest = '';
    try {
      prevManifest = readFileSync(join(process.cwd(), BUILD_MANIFEST), 'utf8').trim();
    } catch {
      // No manifest → fall through to a rebuild.
    }
    if (prevManifest === wantManifest) {
      console.log('E2E build inputs unchanged — reusing existing .output/public bundle.');
      console.log('(set E2E_FORCE_BUILD=1 to force a rebuild)');
      return;
    }
  }

  const build = spawnSync('pnpm', ['build'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_HOST: e2eHost,
      E2E_PORT: String(e2ePort),
      E2E_TEST: '1',
    },
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  try {
    writeFileSync(join(process.cwd(), BUILD_MANIFEST), `${wantHash}:${bundleIndexMtime()}`);
  } catch {
    // Non-fatal: a missing manifest just forces a rebuild next time.
  }
}

async function main() {
  const requestedPort = Number(process.env.E2E_PORT ?? 37107);
  const e2ePort = process.env.E2E_BASE_URL ? requestedPort : await findAvailablePort(requestedPort);
  const baseURL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${e2ePort}`;

  runBuild(e2ePort);

  // Hand the chosen port + built bundle to Playwright and let its own
  // `webServer` (playwright.config.ts) start, readiness-poll and tear down the
  // static preview server. This script owns only build + port selection.
  const playwright = spawn('pnpm', ['exec', 'playwright', ...playwrightArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_HOST: e2eHost,
      E2E_PORT: String(e2ePort),
      E2E_BASE_URL: baseURL,
      E2E_TEST: '1',
    },
  });

  playwright.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
