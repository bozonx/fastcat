import { test as base, expect, type Page } from '@playwright/test';
import { opfsEntryExists, removeOpfsEntry } from '../../utils/e2e/virtual-fs';

const DEFAULT_WEB_WORKSPACE_NAME = 'fastcat-workspace';

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

function createWorkspaceName(): string {
  return DEFAULT_WEB_WORKSPACE_NAME;
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

async function configureWebWorkspaceSandbox(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

export async function selectE2eWorkspace(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'New Project' })).toBeVisible({ timeout: 30_000 });
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
    await page.waitForURL(editorUrlPattern, { timeout: 15_000 });
  } catch {
    // The project was created but navigation didn't happen automatically.
    // Go directly to the editor URL instead of trying to click the project
    // heading — a loading overlay (isTransitioning) may intercept pointer events.
    await page.goto(`/editor/${encodedName}`, { waitUntil: 'domcontentloaded' });
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
  const restoreAutosave = page.getByRole('button', { name: /Restore Work/i });
  if (await restoreAutosave.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await restoreAutosave.click();
    await expect(restoreAutosave).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Loading...' })).toBeHidden({
      timeout: 30_000,
    });
  }
  await expect(page.getByTestId('timeline-container')).toBeVisible({ timeout: 30_000 });
}

export const test = base.extend<WorkspaceFixtures>({
  e2eWorkspace: async ({ page }, use) => {
    const name = createWorkspaceName();
    await configureWebWorkspaceSandbox(page);

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
    await selectE2eWorkspace(page);
    const project = await createE2eProject(page, e2eWorkspace, createProjectName(testInfo.title));

    await use(project);
  },
});

export { expect };
