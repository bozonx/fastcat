export function cloneMonitorValue<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    // ignore and fallback
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
