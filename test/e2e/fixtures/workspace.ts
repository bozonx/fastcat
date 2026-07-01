import { test as base, expect, type Page } from '@playwright/test';
import { opfsEntryExists, removeOpfsEntry } from '../../utils/e2e/virtual-fs';

export const E2E_PROJECT_DIRS = [
  { name: '_video', kind: 'directory' },
  { name: '_audio', kind: 'directory' },
  { name: '_images', kind: 'directory' },
  { name: '_timelines', kind: 'directory' },
  { name: '_export', kind: 'directory' },
  { name: '.fastcat', kind: 'directory' },
] as const;

export interface E2eWorkspace {
  name: string;
}

export interface E2eProject {
  name: string;
  encodedName: string;
  path: string;
  timelinePath: string;
}

interface WorkspaceFixtures {
  e2eWorkspace: E2eWorkspace;
  e2eProject: E2eProject;
}

function createWorkspaceName(testTitle: string, workerIndex: number, retry: number): string {
  const safeTitle = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const random = Math.random().toString(36).slice(2, 8);

  return `e2e-${workerIndex}-${retry}-${safeTitle}-${random}`;
}

function createProjectName(testTitle: string): string {
  const safeTitle = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const random = Math.random().toString(36).slice(2, 8);

  return `E2E Project ${safeTitle} ${random}`;
}

async function mockWorkspacePicker(page: Page, workspaceName: string): Promise<void> {
  await page.addInitScript((name) => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getDirectoryHandle(name, { create: true });
        const permission = async () => 'granted' as PermissionState;

        Object.defineProperties(handle, {
          queryPermission: {
            configurable: true,
            value: permission,
          },
          requestPermission: {
            configurable: true,
            value: permission,
          },
        });

        return handle;
      },
    });
  }, workspaceName);
}

export async function selectE2eWorkspace(page: Page, workspace: E2eWorkspace): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const selectWorkspaceButton = page.getByRole('button', { name: 'Select Workspace Folder' });
  await expect(selectWorkspaceButton).toBeVisible({ timeout: 30_000 });
  await selectWorkspaceButton.click();
  await expect(page.getByText(workspace.name)).toBeVisible();
}

export async function createE2eProject(
  page: Page,
  workspace: E2eWorkspace,
  projectName: string,
): Promise<E2eProject> {
  await page.getByRole('button', { name: 'New Project' }).click();
  await page.getByPlaceholder('Project name').fill(projectName);
  await page.getByRole('button', { name: 'Create' }).click();

  const encodedName = encodeURIComponent(projectName);
  const editorUrlPattern = new RegExp(`/editor/${encodedName}`);

  try {
    await page.waitForURL(editorUrlPattern, { timeout: 2_000 });
  } catch {
    const projectHeading = page.getByRole('heading', { name: projectName });
    if (await projectHeading.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await projectHeading.click();
      await page.waitForURL(editorUrlPattern, { timeout: 2_000 }).catch(() => undefined);
    }
    if (!editorUrlPattern.test(page.url())) {
      await page.goto(`/editor/${encodedName}`, { waitUntil: 'domcontentloaded' });
    }
  }

  await expect(page).toHaveURL(editorUrlPattern);

  const project = {
    name: projectName,
    encodedName,
    path: `${workspace.name}/projects/${projectName}`,
    timelinePath: `${workspace.name}/projects/${projectName}/_timelines/${projectName}_001.otio`,
  };
  await expect
    .poll(() => opfsEntryExists(page, project.timelinePath), { timeout: 20_000 })
    .toBe(true);
  await waitForEditorReady(page);

  return project;
}

export async function waitForEditorReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Loading...' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId('timeline-container')).toBeVisible({ timeout: 30_000 });
}

export const test = base.extend<WorkspaceFixtures>({
  e2eWorkspace: async ({ page }, use, testInfo) => {
    const name = createWorkspaceName(testInfo.title, testInfo.workerIndex, testInfo.retry);
    await mockWorkspacePicker(page, name);

    await use({ name });

    if (!page.isClosed()) {
      try {
        await removeOpfsEntry(page, name);
      } catch {
        // The page can be on an error document after a failed test; cleanup is best-effort.
      }
    }
  },

  e2eProject: async ({ page, e2eWorkspace }, use, testInfo) => {
    await selectE2eWorkspace(page, e2eWorkspace);
    const project = await createE2eProject(page, e2eWorkspace, createProjectName(testInfo.title));

    await use(project);
  },
});

export { expect };
