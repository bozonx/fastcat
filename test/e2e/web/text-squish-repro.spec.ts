import { test, expect } from '../fixtures/workspace';
import { clipIds } from '../../utils/e2e/timeline';

const SHOT_DIR =
  '/tmp/claude-1000/-home-ivank--personal-codeWorkspace-fastcat/3979eda4-06a6-4719-8ac9-669c8d45351d/scratchpad';

test.describe('text squish repro', () => {
  test('multiline text clip renders unsquished', async ({ page, e2eProject }) => {
    void e2eProject;
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[TextDbg]')) console.log('PAGE:', t);
    });

    await page.getByTestId('timeline-container').click();
    await page.keyboard.press('n');

    await expect.poll(async () => (await clipIds(page)).length).toBeGreaterThan(0);
    const id = (await clipIds(page))[0];
    await page.locator(`[data-clip-id="${id}"]`).click();

    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOT_DIR}/repro-1line.png` });

    await page.getByText('TEXT', { exact: true }).click();
    const ta = page.locator('textarea').first();
    await expect(ta).toBeVisible({ timeout: 10_000 });
    await ta.fill('Text\nText\nText\nText\nText\nText\nText');

    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOT_DIR}/repro-7lines.png` });
  });
});
