import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resolves a path inside `packages/shared/` regardless of whether Vitest is run
 * from the monorepo root or from `apps/web/`.
 */
export function resolveSharedPath(subpath: string): string {
  const normalized = subpath.replace(/^(packages\/)?shared\//, '');
  const candidates = [
    resolve(process.cwd(), 'packages/shared', normalized),
    resolve(process.cwd(), '../../packages/shared', normalized),
    resolve(import.meta.dirname, '../../../../packages/shared', normalized),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Default to candidates[0] if not found yet
  return candidates[0];
}
