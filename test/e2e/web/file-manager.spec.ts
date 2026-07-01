import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import {
  createFolder,
  entry,
  entryByPath,
  moveEntry,
  openProjectFilesTab,
  renameEntry,
  seedProjectMedia,
  selectEntries,
  setViewMode,
} from '../../utils/e2e/file-manager';
import { opfsEntryExists } from '../../utils/e2e/virtual-fs';

/**
 * Base file-manager flows visible with premium/in-development flags off. Remote
 * browser, conversion, tasks and timeline DnD are out of scope.
 */
test.describe('Web file manager', () => {
  test('creates a folder that survives reload', async ({ page, e2eProject }) => {
    const folderName = `Folder ${Date.now().toString(36)}`;
    await createFolder(page, folderName);

    await expect(entry(page, folderName)).toBeVisible();
    await page.goto(`/editor/${e2eProject.encodedName}`);
    await expect(page.getByTestId('timeline-container')).toBeVisible();
    await openProjectFilesTab(page);
    await expect.poll(() => opfsEntryExists(page, `${e2eProject.path}/${folderName}`)).toBe(true);
  });

  test('deletes a file from the project and OPFS', async ({ page, e2eProject }) => {
    const { fileName, opfsPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );
    await expect(entry(page, fileName)).toBeVisible();

    await entry(page, fileName).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /delete|удалить/i }).click();
    // Confirm if a dialog appears.
    const confirm = page
      .getByRole('dialog')
      .getByRole('button', { name: /delete|удалить|ok|confirm|подтвердить/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    await expect(entry(page, fileName)).toBeHidden();
    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(false);
  });

  test('renames a file and persists the new OPFS path', async ({ page, e2eProject }) => {
    const { fileName, opfsPath, uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );
    const renamed = `renamed-${fileName}`;
    const renamedUiPath = `_audio/${renamed}`;
    const renamedOpfsPath = `${e2eProject.path}/${renamedUiPath}`;

    await renameEntry(page, uiPath, renamed);

    await expect(entryByPath(page, renamedUiPath)).toBeVisible();
    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(false);
    await expect.poll(() => opfsEntryExists(page, renamedOpfsPath)).toBe(true);
  });

  test('moves a file into a project folder and persists the new OPFS path', async ({
    page,
    e2eProject,
  }) => {
    const folderName = `Moved ${Date.now().toString(36)}`;
    await createFolder(page, folderName);
    const { fileName, opfsPath, uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );
    const movedUiPath = `${folderName}/${fileName}`;
    const movedOpfsPath = `${e2eProject.path}/${movedUiPath}`;

    await moveEntry(page, { sourcePath: uiPath, targetDirPath: folderName });

    await expect(entry(page, fileName)).toBeHidden();
    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(false);
    await expect.poll(() => opfsEntryExists(page, movedOpfsPath)).toBe(true);

    await page.getByRole('treeitem', { name: folderName }).click();
    await expect(entryByPath(page, movedUiPath)).toBeVisible();
  });

  test('supports multi-select of files', async ({ page, e2eProject }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');

    await selectEntries(page, [a.fileName, b.fileName]);
    await expect(entry(page, a.fileName)).toHaveClass(/selection-ring|selection-range-bg/);
    await expect(entry(page, b.fileName)).toHaveClass(/selection-ring|selection-range-bg/);
  });

  test('switches between list and grid views', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');

    await setViewMode(page, 'list');
    await expect(page.locator(`tr[data-entry-path="${uiPath}"]`)).toBeVisible();

    await setViewMode(page, 'grid');
    await expect(page.locator(`div[data-entry-path="${uiPath}"]`)).toBeVisible();
  });

  test('opens the files tab controls', async ({ page, e2eProject: _e2eProject }) => {
    await openProjectFilesTab(page);
    await expect(page.getByTestId('file-upload-input').first()).toBeAttached();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (
              window as Window & {
                __fastcatE2eCreateRootFolder?: (params: { name: string }) => Promise<void>;
              }
            ).__fastcatE2eCreateRootFolder === 'function',
        ),
      )
      .toBe(true);
  });
});
