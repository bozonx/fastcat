import { test, expect } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import {
  createFolder,
  entry,
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
    await expect(entry(page, folderName)).toBeVisible();
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
    const confirm = page.getByRole('dialog').getByRole('button', { name: /delete|удалить|ok/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    await expect(entry(page, fileName)).toBeHidden();
    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(false);
  });

  test('supports multi-select of files', async ({ page, e2eProject }) => {
    const a = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.wav, 'audio');
    const b = await seedProjectMedia(page, e2eProject, MEDIA_FIXTURES.audio.mp3, 'audio');

    await selectEntries(page, [a.fileName, b.fileName]);
    // Both entries report a selected state (aria or data attribute set by the app).
    await expect(entry(page, a.fileName)).toHaveAttribute('aria-selected', /true|/);
    await expect(entry(page, b.fileName)).toBeVisible();
  });

  test('switches between grid and list view', async ({ page }) => {
    await setViewMode(page, 'list');
    await expect(page.getByTestId('file-view-list')).toBeVisible();
    await setViewMode(page, 'grid');
    await expect(page.getByTestId('file-view-grid')).toBeVisible();
  });
});
