import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import {
  contextAction,
  createFolderInCurrentDirectory,
  entry,
  entryByPath,
  invertSelection,
  selectAllEntries,
  selectEntries,
  selectUnusedEntries,
  seedProjectMedia,
} from '../../utils/e2e/file-manager';
import { opfsEntryExists } from '../../utils/e2e/virtual-fs';

/**
 * Bulk file-manager flows on the project Files tab. Tests are limited to the
 * base desktop web scope (no premium/in-development flags).
 */
test.describe('Web file manager bulk operations', () => {
  test('selects all visible entries and inverts the selection', async ({ page, e2eProject }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');

    await selectAllEntries(page);
    await expect(entry(page, a.fileName)).toHaveClass(/selection-ring|selection-range-bg/);
    await expect(entry(page, b.fileName)).toHaveClass(/selection-ring|selection-range-bg/);

    await invertSelection(page);
    await expect(entry(page, a.fileName)).not.toHaveClass(/selection-ring|selection-range-bg/);
    await expect(entry(page, b.fileName)).not.toHaveClass(/selection-ring|selection-range-bg/);
  });

  test('selects unused files through the toolbar menu', async ({ page, e2eProject }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');

    await selectUnusedEntries(page);
    await expect(entry(page, a.fileName)).toHaveClass(/selection-ring|selection-range-bg/);
    await expect(entry(page, b.fileName)).toHaveClass(/selection-ring|selection-range-bg/);
  });

  test('deletes multiple selected files from the project and OPFS', async ({
    page,
    e2eProject,
  }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');

    await selectEntries(page, [a.fileName, b.fileName]);
    await contextAction(page, a.fileName, /delete/i);
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(entry(page, a.fileName)).toBeHidden();
    await expect(entry(page, b.fileName)).toBeHidden();
    await expect.poll(() => opfsEntryExists(page, a.opfsPath)).toBe(false);
    await expect.poll(() => opfsEntryExists(page, b.opfsPath)).toBe(false);
  });

  test('copies multiple selected files into a folder', async ({ page, e2eProject }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');
    const folderName = `BulkCopy ${Date.now().toString(36)}`;
    const targetPath = await createFolderInCurrentDirectory(page, folderName);

    await selectEntries(page, [a.fileName, b.fileName]);
    await contextAction(page, a.fileName, /copy/i);
    await entryByPath(page, targetPath).last().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /paste/i }).click();

    await entryByPath(page, targetPath).last().dblclick();
    await expect(entryByPath(page, `${targetPath}/${a.fileName}`)).toBeVisible();
    await expect(entryByPath(page, `${targetPath}/${b.fileName}`)).toBeVisible();
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/${targetPath}/${a.fileName}`))
      .toBe(true);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/${targetPath}/${b.fileName}`))
      .toBe(true);

    // Original files remain in place.
    await expect.poll(() => opfsEntryExists(page, a.opfsPath)).toBe(true);
    await expect.poll(() => opfsEntryExists(page, b.opfsPath)).toBe(true);
  });

  test('moves multiple selected files into a folder via cut and paste', async ({
    page,
    e2eProject,
  }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');
    const folderName = `BulkMove ${Date.now().toString(36)}`;
    const targetPath = await createFolderInCurrentDirectory(page, folderName);

    await selectEntries(page, [a.fileName, b.fileName]);
    await contextAction(page, a.fileName, /cut/i);
    await entryByPath(page, targetPath).last().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /paste/i }).click();

    await expect(entry(page, a.fileName)).toBeHidden();
    await expect(entry(page, b.fileName)).toBeHidden();

    await entryByPath(page, targetPath).last().dblclick();
    await expect(entryByPath(page, `${targetPath}/${a.fileName}`)).toBeVisible();
    await expect(entryByPath(page, `${targetPath}/${b.fileName}`)).toBeVisible();
    await expect.poll(() => opfsEntryExists(page, a.opfsPath)).toBe(false);
    await expect.poll(() => opfsEntryExists(page, b.opfsPath)).toBe(false);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/${targetPath}/${a.fileName}`))
      .toBe(true);
    await expect
      .poll(() => opfsEntryExists(page, `${e2eProject.path}/${targetPath}/${b.fileName}`))
      .toBe(true);
  });
});
