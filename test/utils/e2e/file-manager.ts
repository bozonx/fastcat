import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForEditorReady, type E2eProject } from '../../e2e/fixtures/workspace';
import { opfsEntryExists, writeFileToOpfs } from './virtual-fs';

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
  /** File-manager path relative to the project root. */
  uiPath: string;
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
  const uiPath = `${MEDIA_SUBDIR[kind]}/${fileName}`;
  const opfsPath = `${project.path}/${uiPath}`;
  const bytes = readFileSync(fixtureAbsPath);

  await writeFileToOpfs(page, { path: opfsPath, data: new Uint8Array(bytes) });
  await page.goto(`/editor/${project.encodedName}`, { waitUntil: 'domcontentloaded' });
  await waitForEditorReady(page);
  await expect.poll(() => opfsEntryExists(page, opfsPath), { timeout: 10_000 }).toBe(true);
  await openProjectFilesTab(page);
  await page
    .getByRole('treeitem', { name: MEDIA_SUBDIR[kind] })
    .click({ timeout: 5_000 })
    .catch(() => undefined);

  return { fileName, opfsPath, uiPath };
}

/** Drives the real import pipeline via the app's file input. */
export async function importViaUpload(page: Page, fixtureAbsPaths: string[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await openProjectFilesTab(page);
    const input = page.getByTestId('file-upload-input').first();
    const attached = await expect(input)
      .toBeAttached({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!attached) continue;

    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5_000 });
    await input.evaluate((element) => (element as HTMLInputElement).click()).catch(() => undefined);
    const chooser = await chooserPromise.catch(() => null);
    if (!chooser) continue;

    await chooser.setFiles(fixtureAbsPaths);
    return;
  }

  throw new Error('Unable to open the file upload chooser');
}

/**
 * Drives the real import pipeline via an OS-style file drag-and-drop onto the
 * app root. Builds a synthetic `DataTransfer` carrying real `File` objects and
 * dispatches `dragover`/`drop` on the `[data-app-root]` element that owns the
 * global drop handler (`useGlobalDragAndDrop`), so the genuine
 * `onGlobalDrop -> handleFiles` ingest path runs — same as an OS drop.
 */
export async function importViaDragDrop(page: Page, fixtureAbsPaths: string[]): Promise<void> {
  const files = fixtureAbsPaths.map((absPath) => ({
    name: basename(absPath),
    base64: readFileSync(absPath).toString('base64'),
  }));

  await expect(page.locator('[data-app-root]')).toBeAttached({ timeout: 10_000 });

  await page.evaluate(async (payload) => {
    const root = document.querySelector('[data-app-root]');
    if (!root) throw new Error('[data-app-root] not found');

    const dataTransfer = new DataTransfer();
    for (const item of payload) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      dataTransfer.items.add(new File([bytes], item.name));
    }

    root.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
    );
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, files);
}

/** Locate a file/folder entry by its visible name (matches any `data-entry-path`). */
export function entry(page: Page, name: string): Locator {
  return page.locator(`[data-entry-path$="/${name}"], [data-entry-path="${name}"]`).first();
}

/** Locate an entry by its exact vfs path. */
export function entryByPath(page: Page, path: string): Locator {
  return page.locator(`[data-entry-path="${path}"]`);
}

export async function openProjectFilesTab(page: Page): Promise<void> {
  const filesTab = page.locator('[data-tab-id="files"]').first();
  await expect(filesTab).toBeVisible({ timeout: 10_000 });

  for (let attempt = 0; attempt < 3; attempt++) {
    await filesTab.click();
    const uploadInput = page.getByTestId('file-upload-input').first();
    if (
      await expect(uploadInput)
        .toBeAttached({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    await filesTab.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
    if (
      await expect(uploadInput)
        .toBeAttached({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
  }

  await expect(page.getByTestId('file-upload-input').first()).toBeAttached({ timeout: 10_000 });
}

export async function setViewMode(page: Page, mode: 'grid' | 'list'): Promise<void> {
  await openProjectFilesTab(page);
  await page.getByTestId(mode === 'grid' ? 'file-view-grid' : 'file-view-list').click();
}

/**
 * Creates a folder through the toolbar action + name modal. The modal is a plain
 * text input + confirm button; located by role to stay resilient to markup.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await openProjectFilesTab(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            typeof (
              window as Window & {
                __fastcatE2eCreateRootFolder?: (params: { name: string }) => Promise<void>;
              }
            ).__fastcatE2eCreateRootFolder === 'function',
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.evaluate(async (folderName) => {
    const createRootFolder = (
      window as Window & {
        __fastcatE2eCreateRootFolder?: (params: { name: string }) => Promise<void>;
      }
    ).__fastcatE2eCreateRootFolder;

    if (!createRootFolder) throw new Error('E2E file-manager create-folder hook is not registered');
    await createRootFolder({ name: folderName });
  }, name);
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
