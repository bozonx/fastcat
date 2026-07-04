import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const e2eHost = process.env.E2E_HOST ?? '127.0.0.1';
const playwrightArgs = process.argv.slice(2);

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

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5_000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);

      if (res.ok || res.status > 0) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

function runBuild(e2ePort) {
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
}

async function main() {
  const requestedPort = Number(process.env.E2E_PORT ?? 37107);
  const e2ePort = process.env.E2E_BASE_URL ? requestedPort : await findAvailablePort(requestedPort);
  const baseURL = process.env.E2E_BASE_URL ?? `http://${e2eHost}:${e2ePort}`;

  runBuild(e2ePort);

  const preview = spawn(
    'node',
    [
      'scripts/static-preview-server.mjs',
      '--host',
      e2eHost,
      '--port',
      String(e2ePort),
      '--root',
      '.output/public',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_HOST: e2eHost,
        E2E_PORT: String(e2ePort),
        E2E_BASE_URL: baseURL,
        E2E_TEST: '1',
      },
    },
  );

  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    if (!preview.killed) {
      preview.kill('SIGTERM');
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  preview.on('exit', (code) => {
    if (!cleanedUp) {
      console.error(
        `Preview server exited before Playwright finished with code ${code ?? 'unknown'}`,
      );
      process.exit(code ?? 1);
    }
  });

  await waitForServer(baseURL);

  const playwright = spawn('pnpm', ['exec', 'playwright', ...playwrightArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_HOST: e2eHost,
      E2E_PORT: String(e2ePort),
      E2E_BASE_URL: baseURL,
      E2E_TEST: '1',
      PLAYWRIGHT_SKIP_WEBSERVER: '1',
    },
  });

  playwright.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
