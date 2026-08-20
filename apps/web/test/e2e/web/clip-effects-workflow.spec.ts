import { test, expect, waitForEditorReady } from '../fixtures/workspace';
import { MEDIA_FIXTURES } from '../../fixtures/media';
import { seedProjectMedia } from '../../utils/e2e/file-manager';
import {
  addFileToTrack,
  clipIds,
  saveTimeline,
  selectClip,
  trackIds,
} from '../../utils/e2e/timeline';
import { waitForTimelineDoc } from '../../utils/e2e/otio';

/**
 * General clip-effects workflow coverage. Effect math and rendered-frame parity
 * live in integration/golden tiers; this spec verifies the user-facing editor
 * path stays wired to preview state and persisted timeline state.
 */
test.describe('Web clip effects workflow', () => {
  test('adds an effect, edits a parameter, and reloads the persisted state', async ({
    page,
    e2eProject,
  }) => {
    const { uiPath } = await seedProjectMedia(
      page,
      e2eProject,
      MEDIA_FIXTURES.video.h264Mp4,
      'video',
    );
    const videoTrackId = (await trackIds(page))[0];
    await addFileToTrack(page, uiPath, videoTrackId);

    // Wait for the clip to settle in the timeline before selecting it: the
    // properties panel renders its "Video" tab off the resolved selection, and
    // reading clipIds() immediately after the async add can race the DOM update
    // (leaving the panel on its empty state with no tabs).
    const clipId = (await waitForTimelineDoc(page, e2eProject, (d) => d.allClips.length === 1))
      .allClips[0]!.id;
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);
    await selectClip(page, clipId);
    await page.getByRole('tab', { name: 'Video' }).click();

    await expect(page.getByTestId('monitor-preview-effects')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('clip-effects-video-add').click();
    await page.getByTestId('select-effect-color-adjustment').click();
    await expect(page.getByTestId('clip-effect-color-adjustment')).toBeVisible();

    const brightnessControl = page.getByTestId('clip-effect-color-adjustment-param-brightness');
    await brightnessControl.locator('input').fill('1.35');
    await brightnessControl.locator('input').blur();
    await saveTimeline(page);

    const edited = await waitForTimelineDoc(page, e2eProject, (doc) => {
      const effect = doc.allClips[0]?.effects.find((item) => item.type === 'color-adjustment');
      return effect?.params.brightness === 1.35;
    });
    const editedEffect = edited.allClips[0]!.effects.find(
      (effect) => effect.type === 'color-adjustment',
    );

    expect(editedEffect).toMatchObject({
      enabled: true,
      target: 'video',
      params: expect.objectContaining({
        brightness: 1.35,
        contrast: 1,
        saturation: 1,
      }),
    });

    await page.goto(`/editor/${e2eProject.encodedName}`);
    await waitForEditorReady(page);
    await expect.poll(async () => (await clipIds(page)).length).toBe(1);

    await selectClip(page, clipId);
    await page.getByRole('tab', { name: 'Video' }).click();
    await expect(page.getByTestId('clip-effect-color-adjustment')).toBeVisible();
    await expect(page.getByTestId('monitor-preview-effects')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const reloaded = await waitForTimelineDoc(page, e2eProject, (doc) => {
      const effect = doc.allClips[0]?.effects.find((item) => item.type === 'color-adjustment');
      return effect?.params.brightness === 1.35;
    });
    expect(reloaded.allClips[0]!.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'color-adjustment',
          params: expect.objectContaining({ brightness: 1.35 }),
        }),
      ]),
    );
  });
});
