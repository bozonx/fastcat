import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Playback-transport + export primitives for web e2e specs.
 *
 * Transport is driven through the monitor's real controls (`data-monitor-play`)
 * and observed through the timeline playhead (`data-testid="timeline-playhead"`)
 * and ruler (`data-testid="timeline-ruler"`). Playhead progress is read from the
 * live DOM transform, so specs assert on what the user actually sees moving
 * rather than on store internals.
 */

export function playButton(page: Page): Locator {
  return page.locator('[data-monitor-play]');
}

export function playhead(page: Page): Locator {
  return page.getByTestId('timeline-playhead');
}

export function ruler(page: Page): Locator {
  return page.getByTestId('timeline-ruler');
}

/** Horizontal pixel position of the playhead line within the viewport. */
export async function playheadX(page: Page): Promise<number> {
  const box = await playhead(page).boundingBox();
  if (!box) throw new Error('playhead has no bounding box');
  return box.x;
}

export async function play(page: Page): Promise<void> {
  await playButton(page).click();
}

export async function pause(page: Page): Promise<void> {
  // Same button toggles; callers use this after confirming playback started.
  await playButton(page).click();
}

/** Asserts the playhead advances while playing, then returns the delta in px. */
export async function expectPlayheadAdvances(
  page: Page,
  options: { forMs?: number } = {},
): Promise<number> {
  const { forMs = 600 } = options;
  const before = await playheadX(page);
  await play(page);
  await expect
    .poll(async () => (await playheadX(page)) - before, { timeout: forMs + 2_000 })
    .toBeGreaterThan(1);
  const after = await playheadX(page);
  await pause(page);
  return after - before;
}

/** Clicks the ruler at a horizontal fraction (0..1) of its width to seek. */
export async function seekRulerFraction(page: Page, fraction: number): Promise<void> {
  const box = await ruler(page).boundingBox();
  if (!box) throw new Error('ruler has no bounding box');
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/** Switches the editor to the export view (real header tab). */
export async function openExport(page: Page): Promise<void> {
  await page.getByTestId('nav-export').click();
  await expect(page.getByTestId('export-start')).toBeVisible();
}

/**
 * Export flow through the real `ExportForm`. Assumes the export panel is already
 * open (spec navigates to the export view first). Returns when the app reports
 * success via `data-testid="export-success"`.
 */
export async function startExport(page: Page): Promise<void> {
  await page.getByTestId('export-start').click();
}

export async function waitForExportSuccess(
  page: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  const { timeout = 60_000 } = options;
  // Progress should show while running; success replaces it when done.
  await expect(page.getByTestId('export-success')).toBeVisible({ timeout });
}
