export interface DevLogger {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

function createLoggerMethod(scope: string, method: keyof Console): (...args: unknown[]) => void {
  const prefix = scope ? `[${scope}]` : '';
  return (...args: unknown[]) => {
    if (!isDev) return;
    const logFn = (console[method] as ((...args: unknown[]) => void) | undefined) ?? console.log;
    if (prefix) {
      logFn(prefix, ...args);
      return;
    }
    logFn(...args);
  };
}

export function createDevLogger(scope: string): DevLogger {
  return {
    log: createLoggerMethod(scope, 'log'),
    info: createLoggerMethod(scope, 'info'),
    warn: createLoggerMethod(scope, 'warn'),
    error: createLoggerMethod(scope, 'error'),
    debug: createLoggerMethod(scope, 'debug'),
  };
}
