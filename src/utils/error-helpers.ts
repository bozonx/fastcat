export function isDomExceptionName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === name
  );
}

export function isNotFoundError(error: unknown): boolean {
  return (
    isDomExceptionName(error, 'NotFoundError') || isDomExceptionName(error, 'VfsNotFoundError')
  );
}
