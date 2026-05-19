import type { Page } from '@playwright/test';

export interface WaitForExportOptions {
  timeout?: number;
}

export interface ExportResult {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

/**
 * Waits for the `fastcat:exported` custom event on the page
 * and returns the exported file as a Uint8Array.
 */
export async function waitForExportComplete(
  page: Page,
  options: WaitForExportOptions = {},
): Promise<ExportResult> {
  const { timeout = 60_000 } = options;

  const exportedPromise = page.evaluate((timeoutMs) => {
    return new Promise<{ file: number[]; filename: string; mimeType: string }>(
      (resolve, reject) => {
        const timerId = window.setTimeout(() => {
          reject(new Error(`Timed out waiting for fastcat:exported after ${timeoutMs}ms`));
        }, timeoutMs);

        window.addEventListener(
          'fastcat:exported',
          (event: any) => {
            const { file, filename } = event.detail;
            const reader = new FileReader();

            reader.onload = () => {
              window.clearTimeout(timerId);
              resolve({
                file: Array.from(new Uint8Array(reader.result as ArrayBuffer)),
                filename,
                mimeType: file.type,
              });
            };

            reader.readAsArrayBuffer(file);
          },
          { once: true },
        );
      },
    );
  }, timeout);

  const result = await exportedPromise;

  return {
    data: new Uint8Array(result.file),
    filename: result.filename,
    mimeType: result.mimeType,
  };
}

/**
 * Loads a local media fixture into OPFS so the editor can import it.
 */
export async function loadFixtureIntoOpfs(
  page: Page,
  fixturePath: string,
  targetPath: string,
): Promise<void> {
  const { writeFileToOpfs } = await import('./virtual-fs');
  const fs = await import('fs/promises');
  const path = await import('path');

  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const buffer = await fs.readFile(absolutePath);

  await writeFileToOpfs(page, { path: targetPath, data: buffer });
}
