import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { writeFileToOpfs } from './virtual-fs';
import type { E2eProject } from '../../e2e/fixtures/workspace';

/**
 * File-manager interaction primitives for web e2e specs.
 *
 * Two distinct import paths are offered on purpose:
 *
 *  - `seedProjectMedia` is a *fast precondition* for specs that need media to
 *    exist but are not testing import (add-clip, trim, move, playback, export).
 *    It writes bytes straight into the project's media directory in OPFS and
 *    reloads, so those specs don't re-drive the import UI on every run.
 *
 *  - `importViaUpload` exercises the *real* import pipeline through the app's
 *    hidden `<input type="file">`, which is what `media-import.spec.ts` should
 *    verify. `setInputFiles` triggers the app's own `change` handler, so the
 *    genuine ingest/copy path runs.
 *
 * File entries are addressable through the app's existing `data-entry-path`
 * attribute; the toolbar carries `file-create-folder`, `file-view-grid`,
 * `file-view-list` test ids, and the upload input carries `file-upload-input`.
 */

const MEDIA_SUBDIR: Record<'video' | 'audio' | 'image', string> = {
  video: '_video',
  audio: '_audio',
  image: '_images',
};

export interface SeededMedia {
  fileName: string;
  /** Absolute OPFS path of the written media file. */
  opfsPath: string;
}

/**
 * Writes a local fixture into the project's media folder in OPFS and reloads
 * the editor so the file manager picks it up. Returns the written file name for
 * locating the entry / matching against the persisted OTIO target url.
 */
export async function seedProjectMedia(
  page: Page,
  project: E2eProject,
  fixtureAbsPath: string,
  kind: 'video' | 'audio' | 'image',
): Promise<SeededMedia> {
  const fileName = basename(fixtureAbsPath);
  const opfsPath = `${project.path}/${MEDIA_SUBDIR[kind]}/${fileName}`;
  const bytes = readFileSync(fixtureAbsPath);

  await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });
  await page.goto(`/editor/${project.encodedName}`);
  await expect(page.getByTestId('timeline-container')).toBeVisible();
  await expect(entry(page, fileName)).toBeVisible({ timeout: 15_000 });

  return { fileName, opfsPath };
}

/** Drives the real import pipeline via the app's file input. */
export async function importViaUpload(page: Page, fixtureAbsPaths: string[]): Promise<void> {
  await page.getByTestId('file-upload-input').setInputFiles(fixtureAbsPaths);
}

/** Locate a file/folder entry by its visible name (matches any `data-entry-path`). */
export function entry(page: Page, name: string): Locator {
  return page.locator(`[data-entry-path$="/${name}"], [data-entry-path="${name}"]`).first();
}

/** Locate an entry by its exact vfs path. */
export function entryByPath(page: Page, path: string): Locator {
  return page.locator(`[data-entry-path="${path}"]`);
}

export async function setViewMode(page: Page, mode: 'grid' | 'list'): Promise<void> {
  await page.getByTestId(mode === 'grid' ? 'file-view-grid' : 'file-view-list').click();
}

/**
 * Creates a folder through the toolbar action + name modal. The modal is a plain
 * text input + confirm button; located by role to stay resilient to markup.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByTestId('file-create-folder').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox').first();
  await input.fill(name);
  await dialog.getByRole('button', { name: /create|ok|confirm|создать/i }).click();
  await expect(dialog).toBeHidden();
}

/** Right-click an entry to open its context menu, then click a menu item. */
export async function contextAction(
  page: Page,
  entryName: string,
  itemName: RegExp,
): Promise<void> {
  await entry(page, entryName).click({ button: 'right' });
  await page.getByRole('menuitem', { name: itemName }).click();
}

export async function selectEntries(page: Page, names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i++) {
    await entry(page, names[i]).click(i === 0 ? {} : { modifiers: ['Control'] });
  }
}
