/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDevLogger } from '~/utils/dev-logger';

describe('createDevLogger', () => {
  let consoleLog: typeof console.log;
  let consoleWarn: typeof console.warn;
  let consoleError: typeof console.error;
  let consoleInfo: typeof console.info;
  let consoleDebug: typeof console.debug;

  beforeEach(() => {
    consoleLog = console.log;
    consoleWarn = console.warn;
    consoleError = console.error;
    consoleInfo = console.info;
    consoleDebug = console.debug;
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.log = consoleLog;
    console.warn = consoleWarn;
    console.error = consoleError;
    console.info = consoleInfo;
    console.debug = consoleDebug;
  });

  it('logs all messages in dev mode (vitest)', () => {
    const logger = createDevLogger('Test');
    logger.error('error msg');
    logger.warn('warn msg');
    logger.log('log msg');
    logger.info('info msg');
    logger.debug('debug msg');

    expect(console.error).toHaveBeenCalledWith('[Test]', 'error msg');
    expect(console.warn).toHaveBeenCalledWith('[Test]', 'warn msg');
    expect(console.log).toHaveBeenCalledWith('[Test]', 'log msg');
    expect(console.info).toHaveBeenCalledWith('[Test]', 'info msg');
    expect(console.debug).toHaveBeenCalledWith('[Test]', 'debug msg');
  });
});
