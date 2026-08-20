// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC_DIR = resolve(ROOT, 'src');
const RUST_LIB = resolve(ROOT, 'src-tauri/src/lib.rs');
const TS_EXTENSIONS = new Set(['.ts', '.vue']);
const REGISTERED_WITHOUT_STATIC_TS_CALL = new Set([
  'native_timeline_render_frame_to_file',
  'webgpu_render_engine_status',
]);

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectSourceFiles(path);
    return TS_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

function extractRegisteredCommands(): string[] {
  const source = readFileSync(RUST_LIB, 'utf8');
  const match = source.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  if (!match) throw new Error('Could not find tauri::generate_handler! block');

  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.replace(/,$/, '').split('::').at(-1))
    .filter((command): command is string => !!command);
}

function extractStaticTsInvokes(): string[] {
  const commands = new Set<string>();
  const invokeCall = /\binvoke(?:<[^)]*?>)?\(\s*['"`]([a-zA-Z0-9_:.-]+)['"`]/g;

  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(invokeCall)) {
      commands.add(match[1]);
    }
  }

  return [...commands].sort();
}

describe('Tauri IPC contracts', () => {
  it('registers every static frontend invoke command in Rust', () => {
    const registered = new Set(extractRegisteredCommands());
    const missing = extractStaticTsInvokes().filter((command) => !registered.has(command));

    expect(missing).toEqual([]);
  });

  it('keeps registered native/media/monitor commands visible to the frontend contract', () => {
    const tsCommands = new Set(extractStaticTsInvokes());
    const unused = extractRegisteredCommands().filter(
      (command) =>
        !tsCommands.has(command) &&
        !REGISTERED_WITHOUT_STATIC_TS_CALL.has(command) &&
        /^(native_|monitor_|allow_)/.test(command),
    );

    expect(unused).toEqual([]);
  });
});
