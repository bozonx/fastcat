<script setup lang="ts">
import { extractMetadata } from '~/workers/core/export';
import { parseMediaMetadata } from '~/utils/video-editor/worker-rpc';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { MediaMetadata } from '~/types/media';

definePageMeta({
  layout: 'blank',
});

/** Flattened probe result handed back to the Playwright test (node context). */
interface ProbeResult {
  ok: boolean;
  mediaType: string;
  /** Decode/display capability as reported by the real web import path. */
  videoCanDecode?: boolean;
  audioCanDecode?: boolean;
  imageCanDisplay?: boolean;
  width?: number;
  height?: number;
  durationSec?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Raw parsed metadata (lets the test feed the real compatibility classifier). */
  meta?: MediaMetadata;
  error?: string;
}

async function readFileFromOpfs(path: string): Promise<File | null> {
  if (!path) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const parts = path.split('/').filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!);
    }
    const handle = await dir.getFileHandle(parts[parts.length - 1]!);
    return await handle.getFile();
  } catch {
    return null;
  }
}

/**
 * Probe one media file through the exact path a real import uses
 * (`extractMetadata` → mediabunny / createImageBitmap) and report what the web
 * engine can actually decode/display in this browser.
 */
async function probe(opfsPath: string, filename: string): Promise<ProbeResult> {
  const mediaType = getMediaTypeFromFilename(filename);
  try {
    const file = await readFileFromOpfs(opfsPath);
    if (!file) return { ok: false, mediaType, error: 'file not found in OPFS' };

    // extractMetadata keys off the filename's extension, so present the real name.
    const named = new File([file], filename, { type: file.type });
    const meta = parseMediaMetadata(await extractMetadata(named));

    return {
      ok: !meta.error,
      mediaType,
      videoCanDecode: meta.video?.canDecode,
      audioCanDecode: meta.audio?.canDecode,
      imageCanDisplay: meta.image?.canDisplay,
      width: meta.video?.width ?? meta.image?.width,
      height: meta.video?.height ?? meta.image?.height,
      durationSec: meta.duration,
      videoCodec: meta.video?.codec,
      audioCodec: meta.audio?.codec,
      meta,
    };
  } catch (e) {
    return { ok: false, mediaType, error: (e as Error).message };
  }
}

onMounted(() => {
  (window as unknown as { __mediaProbe: { probe: typeof probe } }).__mediaProbe = { probe };
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-neutral-900 text-neutral-100">
    <div class="text-center">
      <h1 class="text-xl font-bold">Media Probe Test Page</h1>
      <p class="mt-2 text-sm text-neutral-400">window.__mediaProbe is ready</p>
    </div>
  </div>
</template>
