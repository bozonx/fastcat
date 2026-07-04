import { test, expect } from '../fixtures/workspace';
import type { Locator, Page } from '@playwright/test';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import {
  createFolderInCurrentDirectory,
  entryByPath,
  openProjectFilesTab,
  seedProjectMedia,
} from '../../utils/e2e/file-manager';
import { opfsEntryExists } from '../../utils/e2e/virtual-fs';
import { clip, clipIds, track, trackIds } from '../../utils/e2e/timeline';
import { readTimelineDoc, waitForTimelineDoc } from '../../utils/e2e/otio';

interface Point {
  x: number;
  y: number;
}

async function centerOf(locator: Locator, name: string): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} has no bounding box`);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function timelineClipDragPoint(locator: Locator, name: string): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} has no bounding box`);
  return {
    x: box.x + Math.max(2, Math.min(box.width - 2, box.width * 0.35)),
    y: box.y + Math.max(2, box.height - 6),
  };
}

async function dispatchPointerEvent(
  page: Page,
  target: Locator | 'window',
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: Point,
  options: { pointerId: number; buttons: number; button?: number },
): Promise<void> {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: options.pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: options.button ?? 0,
    buttons: options.buttons,
    clientX: point.x,
    clientY: point.y,
  };

  if (target === 'window') {
    await page.evaluate(
      ({ eventType, eventInit }) => {
        window.dispatchEvent(new PointerEvent(eventType, eventInit));
      },
      { eventType: type, eventInit: init },
    );
    return;
  }

  await target.dispatchEvent(type, init);
}

async function pointInTrack(page: Page, trackId: string, offsetX = 80): Promise<Point> {
  const box = await track(page, trackId).boundingBox();
  if (!box) throw new Error(`track ${trackId} has no bounding box`);
  return {
    x: box.x + Math.min(offsetX, Math.max(20, box.width - 20)),
    y: box.y + box.height / 2,
  };
}

async function startPointerDrag(page: Page, source: Locator, name: string): Promise<Point> {
  const start = await centerOf(source, name);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 1);
  await expect(page.locator('.fastcat-dnd-ghost')).toBeVisible({ timeout: 5_000 });
  return start;
}

async function dropPointerAt(page: Page, target: Point): Promise<void> {
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden({ timeout: 5_000 });
}

async function dragEntryToTrack(page: Page, entryPath: string, trackId: string): Promise<void> {
  await openProjectFilesTab(page);
  await startPointerDrag(page, entryByPath(page, entryPath), `entry ${entryPath}`);
  await dropPointerAt(page, await pointInTrack(page, trackId));
}

function contentEntryByPath(page: Page, path: string): Locator {
  return page.locator(`[data-entry-path="${path}"]`).last();
}

async function dragEntryToFolder(
  page: Page,
  sourcePath: string,
  targetFolderPath: string,
  options: { shift?: boolean } = {},
): Promise<void> {
  await openProjectFilesTab(page);
  if (options.shift) await page.keyboard.down('Shift');
  try {
    await startPointerDrag(page, entryByPath(page, sourcePath), `entry ${sourcePath}`);
    const target = await centerOf(
      contentEntryByPath(page, targetFolderPath),
      `folder ${targetFolderPath}`,
    );
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(
      page.locator(options.shift ? '.fastcat-dnd-badge--green' : '.fastcat-dnd-badge--amber'),
    ).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden({ timeout: 5_000 });
  } finally {
    if (options.shift) await page.keyboard.up('Shift');
  }
}

test.describe('Web pointer DnD', () => {
  test.slow();

  test('drops a file-manager file onto the timeline and cleans up the ghost', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath, fileName } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0]!;

    await dragEntryToTrack(page, uiPath, videoTrackId);

    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
    const doc = await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    expect(doc.allClips[0].targetUrl ?? '').toContain(fileName);
    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden();
  });

  test('releases a cancelled internal file drag cleanly so the next drag still works', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0]!;

    await openProjectFilesTab(page);
    await startPointerDrag(page, entryByPath(page, uiPath), `entry ${uiPath}`);
    await page.mouse.move(8, 8, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden({ timeout: 5_000 });
    expect((await readTimelineDoc(page, e2eProject)).allClips).toHaveLength(0);

    await dragEntryToTrack(page, uiPath, videoTrackId);

    await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1);
    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden();
  });

  test('treats pointerdown and pointerup without movement as a click, not a drag', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    await openProjectFilesTab(page);

    const source = entryByPath(page, uiPath);
    const start = await centerOf(source, `entry ${uiPath}`);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden();
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
    expect((await readTimelineDoc(page, e2eProject)).allClips).toHaveLength(0);
  });

  test('cancels an active pointer drag with Escape', async ({ page, e2eProject }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0]!;

    await openProjectFilesTab(page);
    await startPointerDrag(page, entryByPath(page, uiPath), `entry ${uiPath}`);
    const target = await pointInTrack(page, videoTrackId);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(page.locator('.fastcat-dnd-ghost')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden({ timeout: 5_000 });
    await expect.poll(async () => (await clipIds(page)).length).toBe(0);
    expect((await readTimelineDoc(page, e2eProject)).allClips).toHaveLength(0);
  });

  test('copies a file-manager file when Layer1 is held during folder drop', async ({
    page,
    e2eProject,
  }) => {
    const { fileName, opfsPath, uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );
    const folderName = `Copy Target ${Date.now().toString(36)}`;
    const folderPath = await createFolderInCurrentDirectory(page, folderName);
    const copiedOpfsPath = `${e2eProject.path}/${folderPath}/${fileName}`;

    await dragEntryToFolder(page, uiPath, folderPath, { shift: true });

    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(true);
    await expect.poll(() => opfsEntryExists(page, copiedOpfsPath)).toBe(true);
  });

  test('moves a file-manager file by default during folder drop', async ({ page, e2eProject }) => {
    const { fileName, opfsPath, uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.audio.wav,
      'audio',
    );
    const folderName = `Move Target ${Date.now().toString(36)}`;
    const folderPath = await createFolderInCurrentDirectory(page, folderName);
    const movedOpfsPath = `${e2eProject.path}/${folderPath}/${fileName}`;

    await dragEntryToFolder(page, uiPath, folderPath);

    await expect.poll(() => opfsEntryExists(page, opfsPath)).toBe(false);
    await expect.poll(() => opfsEntryExists(page, movedOpfsPath)).toBe(true);
  });

  test.fixme('moves an existing timeline clip position with a real pointer drag', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0]!;
    await dragEntryToTrack(page, uiPath, videoTrackId);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
    const currentClip = clip(page).first();
    await expect(currentClip).toBeVisible({ timeout: 10_000 });
    const clipId = await currentClip.getAttribute('data-clip-id');
    expect(clipId).toBeTruthy();
    const before = await waitForTimelineDoc(page, e2eProject, (d) =>
      d.allClips.some((c) => c.id === clipId),
    );
    const beforeClip = before.allClips.find((c) => c.id === clipId);
    expect(beforeClip).toBeTruthy();

    const start = await timelineClipDragPoint(currentClip, `clip ${clipId}`);
    const pointerId = 41;
    await dispatchPointerEvent(page, currentClip, 'pointerdown', start, {
      pointerId,
      button: 0,
      buttons: 1,
    });
    await dispatchPointerEvent(
      page,
      'window',
      'pointermove',
      { x: start.x + 12, y: start.y + 1 },
      {
        pointerId,
        buttons: 1,
      },
    );
    await page.waitForTimeout(50);
    await dispatchPointerEvent(
      page,
      'window',
      'pointermove',
      { x: start.x + 180, y: start.y + 1 },
      {
        pointerId,
        buttons: 1,
      },
    );
    await page.waitForTimeout(50);
    await dispatchPointerEvent(
      page,
      'window',
      'pointerup',
      { x: start.x + 180, y: start.y + 1 },
      {
        pointerId,
        buttons: 0,
      },
    );

    const moved = await waitForTimelineDoc(
      page,
      e2eProject,
      (d) =>
        d.allClips.length === 1 &&
        d.allClips[0].id === clipId &&
        d.allClips[0].timelineStartUs > (beforeClip?.timelineStartUs ?? 0),
      { timeout: 15_000 },
    );
    expect(moved.allClips[0].timelineStartUs).toBeGreaterThan(beforeClip!.timelineStartUs);
    await expect(page.locator('.fastcat-dnd-ghost')).toBeHidden();
  });
});
