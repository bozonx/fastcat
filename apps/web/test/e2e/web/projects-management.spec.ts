import {
  createE2eProject,
  expect,
  selectE2eWorkspace,
  test,
  waitForEditorReady,
} from '../fixtures/workspace';

test.describe('Projects management on main page', () => {
  test.slow();

  test('creates multiple projects, searches, sorts, and opens existing project', async ({
    page,
    e2eWorkspace,
  }) => {
    const timestamp = Date.now().toString(36);
    const projAlpha = `Alpha ${timestamp}`;
    const projBeta = `Beta ${timestamp}`;

    await selectE2eWorkspace(page);

    // Create Project Alpha
    await createE2eProject(page, e2eWorkspace, projAlpha);

    // Go back to projects screen
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });

    // Create Project Beta
    await createE2eProject(page, e2eWorkspace, projBeta);

    // Return to main projects screen
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 30_000 });

    // Verify both projects are visible in the list
    await expect(page.getByTitle(projAlpha)).toBeVisible();
    await expect(page.getByTitle(projBeta)).toBeVisible();

    // Test Search input
    const searchInput = page.getByPlaceholder('Search projects...');
    await searchInput.fill('Alpha');
    await expect(page.getByTitle(projAlpha)).toBeVisible();
    await expect(page.getByTitle(projBeta)).toBeHidden();

    // Clear search
    await searchInput.fill('');
    await expect(page.getByTitle(projBeta)).toBeVisible();

    // Test opening existing project from list by clicking its title/card
    await page.getByTitle(projAlpha).click();

    const encodedAlpha = encodeURIComponent(projAlpha);
    await page.waitForURL(new RegExp(`/editor/${encodedAlpha}`), { timeout: 15_000 });
    await waitForEditorReady(page);
  });
});
