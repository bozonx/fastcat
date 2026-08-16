/**
 * Single source of truth for the static preview server used by the e2e/golden
 * tiers. Consumed by:
 *   - `playwright.config.ts`      → `webServer.command` (Playwright owns the
 *     lifecycle for the test-run path)
 *   - `scripts/gen-golden.ts`     → spawns the server itself while it drives a
 *     browser directly (no `playwright test` runner in that path)
 *
 * Keep the spawn shape here so those callers can never drift apart.
 */

export const STATIC_PREVIEW_SCRIPT = 'scripts/static-preview-server.mjs';
export const DEFAULT_PREVIEW_ROOT = '.output/public';

/** Args for `node scripts/static-preview-server.mjs …` over a built bundle. */
export function staticPreviewServerArgs({ host, port, root = DEFAULT_PREVIEW_ROOT }) {
  return [STATIC_PREVIEW_SCRIPT, '--host', host, '--port', String(port), '--root', root];
}

/** Single-string form for Playwright's `webServer.command`. */
export function staticPreviewServerCommand(options) {
  return `node ${staticPreviewServerArgs(options).join(' ')}`;
}

/** Polls `url` until it responds (any status) or `timeoutMs` elapses. */
export async function waitForServer(url, timeoutMs = 120_000) {
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

/**
 * Port/URL of the embed host stand — the second origin the `embed` tier drives
 * the editor from. Shared by `playwright.config.ts` (which starts the server)
 * and the specs (which navigate to it) so the two cannot drift.
 */
export function embedHostPort(e2ePort) {
  return Number(process.env.EMBED_HOST_PORT ?? e2ePort + 100);
}

export function embedHostUrl(host, e2ePort) {
  return `http://${host}:${embedHostPort(e2ePort)}`;
}
