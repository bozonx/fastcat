import { test, expect } from '../fixtures/workspace';
import {
  listOpfsDirectory,
  opfsEntryExists,
  readTextFileFromOpfs,
} from '../../utils/e2e/virtual-fs';

test.describe('Web workspace file operations', () => {
  test('creates a project and persists its files in the selected OPFS workspace', async ({
    page,
    e2eWorkspace,
  }) => {
    const projectName = `Project ${Date.now().toString(36)}`;
    const encodedProjectName = encodeURIComponent(projectName);
    const projectPath = `${e2eWorkspace.name}/projects/${projectName}`;
    const timelinePath = `${projectPath}/_timelines/${projectName}_001.otio`;

    await page.goto('/');
    await page.getByRole('button', { name: 'Select Workspace Folder' }).click();

    await expect(page.getByText(e2eWorkspace.name)).toBeVisible();

    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByPlaceholder('Project name').fill(projectName);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(new RegExp(`/editor/${encodedProjectName}`));
    await expect.poll(() => opfsEntryExists(page, timelinePath), { timeout: 10_000 }).toBe(true);

    const entries = await listOpfsDirectory(page, projectPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: '_video', kind: 'directory' },
        { name: '_audio', kind: 'directory' },
        { name: '_images', kind: 'directory' },
        { name: '_documents', kind: 'directory' },
        { name: '_timelines', kind: 'directory' },
        { name: '_export', kind: 'directory' },
        { name: '.fastcat', kind: 'directory' },
      ]),
    );

    const timeline = JSON.parse(await readTextFileFromOpfs(page, timelinePath)) as {
      OTIO_SCHEMA?: string;
      name?: string;
    };

    expect(timeline).toMatchObject({
      OTIO_SCHEMA: 'Timeline.1',
      name: projectName,
    });
  });
});
