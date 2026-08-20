export function getErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  if (!('message' in error)) return fallback;

  const message = (error as { message?: unknown }).message;

  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (!('name' in error)) return false;

  return (error as { name?: unknown }).name === 'AbortError';
}

/** Normalizes any thrown value into an {@link Error}. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
