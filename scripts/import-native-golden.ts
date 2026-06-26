/**
 * Import native golden hashes from the Rust engine_parity test output.
 *
 * Runs the native parity suite, captures the GOLDEN[native] lines printed to
 * stderr when no native golden entry exists yet, and upserts them into
 * shared/golden/frames.json.
 *
 * Usage:
 *   pnpm test:parity:import-native
 *
 * The test skips gracefully if ffmpeg, ffprobe, or a wgpu adapter are missing;
 * in that case no GOLDEN lines are emitted and this script warns accordingly.
 */
import { spawn } from 'node:child_process';
import {
  loadGoldenRegistry,
  saveGoldenRegistry,
  upsertGoldenSample,
} from '../test/parity-helpers/golden-compare';

const GOLDEN_RE = /^GOLDEN\[native\]\s+(\S+)\s+t=([\d.]+)\s+hash=([0-9a-f]{16})\s+tolerance=(\d+)/i;

function runNativeParity(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'cargo',
      [
        'test',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        '--features',
        'test-support',
        '--test',
        'engine_parity',
        '--',
        '--nocapture',
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      // Cargo may exit non-zero when placeholder golden hashes cause assertion
      // failures, but the GOLDEN[native] lines are still printed to stderr
      // before the assertion fires. Capture them regardless of exit code.
      const output = stderr + stdout;
      if (code !== 0 && output.length === 0) {
        reject(
          new Error(`cargo test engine_parity exited with code ${code} and produced no output`),
        );
        return;
      }
      resolve(output);
    });
  });
}

async function main(): Promise<void> {
  console.log('Running native parity tests to collect golden hashes...\n');

  const output = await runNativeParity();

  const registry = loadGoldenRegistry();
  let imported = 0;

  for (const line of output.split('\n')) {
    const match = GOLDEN_RE.exec(line.trim());
    if (!match) continue;

    const [, filename, timeStr, hash, toleranceStr] = match;
    const timeSec = Number(timeStr);
    const tolerance = Number(toleranceStr);

    if (!Number.isFinite(timeSec) || !Number.isFinite(tolerance)) {
      console.warn(`Skipping malformed line: ${line}`);
      continue;
    }

    upsertGoldenSample(registry, filename, 'native', timeSec, hash, tolerance);
    console.log(`  native  ${filename} t=${timeSec}s hash=${hash} tolerance=${tolerance}`);
    imported++;
  }

  if (imported === 0) {
    console.warn(
      '\nNo GOLDEN[native] lines found. The native tests likely skipped (no ffmpeg/ffprobe or wgpu adapter).',
    );
    console.warn('Install ffmpeg/ffprobe and ensure a wgpu adapter is available, then retry.');
    process.exit(1);
  }

  saveGoldenRegistry(registry);
  console.log(`\nImported ${imported} native golden sample(s) into shared/golden/frames.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
