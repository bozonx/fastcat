import { normalizeFsPath } from './path';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  const source = normalizeFsPath(params.sourcePath);
  const target = normalizeFsPath(params.targetDirPath);

  if (!source) return true;
  if (!target) return true;
  if (target === source) return false;
  if (target.startsWith(`${source}/`)) return false;
  return true;
}
