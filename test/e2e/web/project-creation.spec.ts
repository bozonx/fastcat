import {
  E2E_PROJECT_DIRS,
  createE2eProject,
  expect,
  selectE2eWorkspace,
  test,
} from '../fixtures/workspace';
import {
  listOpfsDirectory,
  opfsEntryExists,
  readTextFileFromOpfs,
} from '../../utils/e2e/virtual-fs';

test.describe('Web project creation', () => {
  test('creates a project, verifies FS structure and renders the timeline', async ({
    page,
    e2eWorkspace,
  }) => {
    const projectName = `Project ${Date.now().toString(36)}`;
    await selectE2eWorkspace(page, e2eWorkspace);
    const project = await createE2eProject(page, e2eWorkspace, projectName);

    await expect.poll(() => opfsEntryExists(page, project.path), { timeout: 10_000 }).toBe(true);

    const entries = await listOpfsDirectory(page, project.path);
    expect(entries).toEqual(expect.arrayContaining([...E2E_PROJECT_DIRS]));

    await expect
      .poll(() => opfsEntryExists(page, project.timelinePath), { timeout: 10_000 })
      .toBe(true);

    const timeline = JSON.parse(await readTextFileFromOpfs(page, project.timelinePath)) as {
      OTIO_SCHEMA?: string;
      name?: string;
    };

    expect(timeline).toMatchObject({
      OTIO_SCHEMA: 'Timeline.1',
      name: projectName,
    });
  });
});
