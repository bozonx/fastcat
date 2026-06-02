let nativeMonitorDisabled = false;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isNativeMonitorDisabled(): boolean {
  return nativeMonitorDisabled;
}

export function markNativeMonitorInitFailure(error: unknown): boolean {
  if (!errorMessage(error).includes('monitor init failed')) return false;
  const wasDisabled = nativeMonitorDisabled;
  nativeMonitorDisabled = true;
  return !wasDisabled;
}

export function resetNativeMonitorAvailability(): void {
  nativeMonitorDisabled = false;
}
