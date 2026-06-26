/** @vitest-environment node */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { renderWebFrames, type WebFrameResult } from './web-render';
import type { Page } from '@playwright/test';

interface MockPage {
  page: Page;
  evaluateMock: Mock;
  waitForFunctionMock: Mock;
}

function createMockPage(currentUrl = 'about:blank'): MockPage {
  const evaluateMock = vi.fn();
  const waitForFunctionMock = vi.fn();

  const page = {
    evaluate: evaluateMock,
    goto: vi.fn(),
    waitForFunction: waitForFunctionMock,
    url: vi.fn().mockReturnValue(currentUrl),
  } as unknown as Page;

  return { page, evaluateMock, waitForFunctionMock };
}

describe('web-render', () => {
  it('navigates to /test/parity when not already there', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage('about:blank');
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([{ hash: 'ffffffffffffffff', width: 320, height: 240 }]);

    await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5],
      },
      {},
    );

    expect(page.goto).toHaveBeenCalledWith('/test/parity');
  });

  it('skips navigation when already on /test/parity', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage(
      'http://localhost:3007/test/parity',
    );
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([{ hash: 'ffffffffffffffff', width: 320, height: 240 }]);

    await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5],
      },
      {},
    );

    expect(page.goto).not.toHaveBeenCalled();
  });

  it('waits for the parity engine to be exposed before rendering', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage('about:blank');
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([{ hash: 'ffffffffffffffff', width: 320, height: 240 }]);

    await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5],
      },
      {},
    );

    expect(page.waitForFunction).toHaveBeenCalled();
  });

  it('returns frame results from the page engine', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage('about:blank');
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([
      { hash: 'aaaaaaaaaaaaaaaa', width: 320, height: 240 },
      { hash: 'bbbbbbbbbbbbbbbb', width: 320, height: 240, error: 'boom' },
    ]);

    const results = await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5, 1.0],
      },
      {},
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.hash).toBe('aaaaaaaaaaaaaaaa');
    expect(results[1]?.hash).toBe('bbbbbbbbbbbbbbbb');
    expect(results[1]?.error).toBe('boom');
  });

  it('passes the media mapping to the page engine', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage('about:blank');
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([{ hash: 'ffffffffffffffff', width: 320, height: 240 }]);

    const mapping = { 'image/image.jpg': 'parity-media/image/image.jpg' };
    await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5],
      },
      mapping,
    );

    const request = evaluateMock.mock.calls[0]?.[1] as { mediaMapping: typeof mapping };
    expect(request.mediaMapping).toEqual(mapping);
  });

  it('propagates render errors inside the returned results', async () => {
    const { page, evaluateMock, waitForFunctionMock } = createMockPage('about:blank');
    waitForFunctionMock.mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue([
      { hash: '', width: 320, height: 240, error: 'webgpu init failed' },
    ] as WebFrameResult[]);

    const results = await renderWebFrames(
      page,
      {
        scene: { layers: [], width: 320, height: 240 },
        sample_times_sec: [0.5],
      },
      {},
    );

    expect(results[0]?.error).toBe('webgpu init failed');
  });
});
