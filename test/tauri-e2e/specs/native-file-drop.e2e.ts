import fs from 'node:fs';
import path from 'node:path';
import { browser, expect, $ } from '@wdio/globals';
import { prepareFixtureInTemp, removeE2eTempDir } from '../helpers/fs.js';

interface RecentProject {
  projectName: string;
  projectPath?: string;
}

interface TauriDropPayload {
  type: 'over' | 'drop' | 'leave';
  paths?: string[];
  position?: { x: number; y: number };
}

async function clickButtonByText(pattern: RegExp): Promise<void> {
  const clicked = await browser.waitUntil(
    async () =>
      browser.execute(
        (source, flags) => {
          const re = new RegExp(source, flags);
          const buttons = Array.from(document.querySelectorAll('button'));
          const button = buttons.find((candidate) => {
            const style = window.getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            const isVisible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0;
            return isVisible && !candidate.disabled && re.test(candidate.textContent ?? '');
          });
          if (!button) return false;
          button.click();
          return true;
        },
        pattern.source,
        pattern.flags,
      ),
    {
      timeout: 10_000,
      timeoutMsg: `Button matching ${pattern.toString()} did not become clickable`,
    },
  );

  expect(clicked).toBe(true);
}

async function createProject(projectName: string): Promise<void> {
  await $('[data-app-root]').waitForExist({ timeout: 30_000 });
  await clickButtonByText(/New Project|Новый проект/);

  const nameInput = await $(
    '//input[contains(@placeholder, "Project name") or contains(@placeholder, "Название проекта")]',
  );
  await nameInput.waitForDisplayed({ timeout: 10_000 });
  await nameInput.setValue(projectName);

  await clickButtonByText(/^Create$|^Создать$/);

  await browser.waitUntil(async () => (await browser.getUrl()).includes('/editor/'), {
    timeout: 30_000,
    timeoutMsg: 'Project editor did not open after creating a project',
  });

  await $('[data-testid="timeline-container"]').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Project editor did not finish loading after creating a project',
  });
}

async function waitForTauriDropBridge(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        () => typeof (window as any).__fastcatE2eDispatchTauriDropEvent === 'function',
      ),
    {
      timeout: 10_000,
      timeoutMsg:
        'Tauri drop e2e bridge is not available. Rebuild the Tauri e2e binary with E2E_TEST=1.',
    },
  );
}

async function dispatchTauriDrop(payload: TauriDropPayload): Promise<void> {
  await browser.execute(async (dropPayload) => {
    const dispatch = (window as any).__fastcatE2eDispatchTauriDropEvent;
    if (typeof dispatch !== 'function') {
      throw new Error('Tauri drop e2e bridge is not registered');
    }
    await dispatch(dropPayload);
  }, payload);
}

async function readRecentProject(projectName: string): Promise<RecentProject | null> {
  return browser.execute((name) => {
    const raw = localStorage.getItem('fastcat_recent_projects');
    if (!raw) return null;
    const projects = JSON.parse(raw) as RecentProject[];
    return projects.find((project) => project.projectName === name) ?? null;
  }, projectName);
}

describe('Tauri Native File Drop (P1)', () => {
  let tempDir: string;
  let tempPath: string;
  let projectPath: string | undefined;

  beforeEach(() => {
    const prepared = prepareFixtureInTemp('media/sample-1s-720p.mp4');
    tempDir = prepared.tempDir;
    tempPath = prepared.tempPath;
    projectPath = undefined;
  });

  afterEach(() => {
    removeE2eTempDir(tempDir);
    if (projectPath && fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('imports a native dropped video file into the project video folder', async () => {
    const projectName = `Tauri Drop ${Date.now().toString(36)}`;
    await createProject(projectName);
    const recentProject = await readRecentProject(projectName);
    projectPath = recentProject?.projectPath;
    expect(projectPath).toBeTruthy();

    await waitForTauriDropBridge();

    await dispatchTauriDrop({
      type: 'drop',
      paths: [tempPath],
      position: { x: 24, y: 24 },
    });

    const expectedFilePath = path.join(projectPath!, '_video', path.basename(tempPath));
    await browser.waitUntil(() => fs.existsSync(expectedFilePath), {
      timeout: 20_000,
      timeoutMsg: `Dropped file did not appear in project video folder: ${expectedFilePath}`,
    });

    expect(fs.existsSync(expectedFilePath)).toBe(true);
  });
});
